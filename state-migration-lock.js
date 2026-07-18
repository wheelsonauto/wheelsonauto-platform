'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_LOCK_NAME = '.woa-postgres-migration.lock';
const DEFAULT_RECOVERY_MIN_AGE_MS = 5 * 60 * 1000;

function normalizedChecksum(value) {
  const checksum = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(checksum) ? checksum : '';
}

function checksumBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lockFilePath(options = {}) {
  const configured = String(options.lockFile || process.env.WOA_STATE_MIGRATION_LOCK_FILE || '').trim();
  if (configured) return path.resolve(configured);
  const directory = options.dataFile
    ? path.dirname(path.resolve(options.dataFile))
    : path.resolve(options.dataDir || process.env.DATA_DIR || process.cwd());
  return path.join(directory, DEFAULT_LOCK_NAME);
}

async function lockStatus(options = {}) {
  const file = lockFilePath(options);
  try {
    const raw = await fs.readFile(file, 'utf8');
    try {
      const record = JSON.parse(raw);
      return { active: true, file, valid: !!(record && record.token && record.acquiredAt), record: record || {} };
    } catch {
      return { active: true, file, valid: false, record: {}, error: 'The migration lock metadata is invalid. Writes remain blocked until the owner reviews it.' };
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { active: false, file, valid: true, record: {} };
    throw error;
  }
}

function lockedError(status = {}) {
  const record = status.record || {};
  const error = new Error('WheelsonAuto is temporarily read-only while the controlled PostgreSQL cutover protects live customer and payment data. Retry after the owner completes or cancels the migration.');
  error.code = 'woa_postgres_migration_write_lock';
  error.statusCode = 503;
  error.retryAfterSeconds = 30;
  error.lockedAt = String(record.acquiredAt || '');
  return error;
}

async function assertWritesAllowed(options = {}) {
  const status = await lockStatus(options);
  if (status.active) throw lockedError(status);
  return status;
}

async function acquire(options = {}) {
  const file = lockFilePath(options);
  const token = crypto.randomBytes(24).toString('hex');
  const record = {
    version: 1,
    token,
    acquiredAt: new Date().toISOString(),
    pid: process.pid,
    reason: String(options.reason || 'controlled JSON-to-PostgreSQL cutover').slice(0, 240),
    sourceFile: options.dataFile ? path.resolve(options.dataFile) : '',
    sourceFileChecksum: String(options.sourceFileChecksum || '').trim()
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const status = await lockStatus({ lockFile: file });
      const conflict = lockedError(status);
      conflict.message = 'A controlled PostgreSQL migration lock already exists. Do not start a second import or remove the lock until the running/failed migration is reviewed.';
      throw conflict;
    }
    throw error;
  }
  return { ...record, file };
}

async function release(lock = {}) {
  const file = lockFilePath({ lockFile: lock.file || lock.lockFile });
  const status = await lockStatus({ lockFile: file });
  if (!status.active) return { released: false, file, missing: true };
  if (!status.valid || !lock.token || status.record.token !== lock.token) {
    const error = new Error('Refusing to release a PostgreSQL migration lock owned by another or unknown process. Review the lock before restoring writes.');
    error.code = 'woa_postgres_migration_lock_owner_mismatch';
    throw error;
  }
  await fs.rm(file);
  return { released: true, file };
}

async function recoverStale(options = {}) {
  const status = await lockStatus(options);
  if (!status.active) {
    const error = new Error('No PostgreSQL migration lock exists. There is nothing to recover.');
    error.code = 'woa_postgres_migration_lock_missing';
    throw error;
  }
  if (!status.valid) {
    const error = new Error('The PostgreSQL migration lock metadata is invalid. Preserve and inspect the lock before restoring writes.');
    error.code = 'woa_postgres_migration_lock_invalid';
    throw error;
  }
  const expectedSourceChecksum = normalizedChecksum(options.expectedSourceChecksum);
  if (!expectedSourceChecksum) {
    throw new Error('A valid 64-character source SHA-256 checksum is required to recover a stale PostgreSQL migration lock.');
  }
  const lockedSourceChecksum = normalizedChecksum(status.record.sourceFileChecksum);
  if (!lockedSourceChecksum || lockedSourceChecksum !== expectedSourceChecksum) {
    throw new Error('The supplied source checksum does not match the protected source recorded by the PostgreSQL migration lock.');
  }
  const dataFile = path.resolve(options.dataFile || status.record.sourceFile || '');
  if (!status.record.sourceFile || path.resolve(status.record.sourceFile) !== dataFile) {
    throw new Error('The supplied protected source path does not match the PostgreSQL migration lock.');
  }
  const currentSourceChecksum = checksumBytes(await fs.readFile(dataFile));
  if (currentSourceChecksum !== expectedSourceChecksum) {
    throw new Error('The protected JSON source changed after the PostgreSQL migration lock was acquired. Keep writes blocked and reconcile the source before recovery.');
  }
  const acquiredAtMs = Date.parse(status.record.acquiredAt);
  const minAgeMs = Number.isFinite(Number(options.minAgeMs))
    ? Math.max(0, Number(options.minAgeMs))
    : DEFAULT_RECOVERY_MIN_AGE_MS;
  if (!Number.isFinite(acquiredAtMs) || Date.now() - acquiredAtMs < minAgeMs) {
    const error = new Error('The PostgreSQL migration lock is not old enough to treat as stale. Wait for the active migration or its cleanup to finish.');
    error.code = 'woa_postgres_migration_lock_not_stale';
    throw error;
  }
  const recoveredAt = new Date().toISOString();
  const suffix = recoveredAt.replace(/[^0-9]/g, '').slice(0, 14) + '-' + String(status.record.token).slice(0, 12);
  const recoveryFile = status.file + '.recovered-' + suffix + '.json';
  try {
    await fs.rename(status.file, recoveryFile);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const conflict = new Error('The PostgreSQL migration lock changed while recovery was being verified. Recheck its status before continuing.');
      conflict.code = 'woa_postgres_migration_lock_recovery_race';
      throw conflict;
    }
    throw error;
  }
  return {
    recovered: true,
    file: status.file,
    recoveryFile,
    recoveredAt,
    acquiredAt: status.record.acquiredAt,
    sourceFile: dataFile,
    sourceFileChecksum: currentSourceChecksum
  };
}

module.exports = {
  DEFAULT_LOCK_NAME,
  DEFAULT_RECOVERY_MIN_AGE_MS,
  lockFilePath,
  lockStatus,
  assertWritesAllowed,
  acquire,
  release,
  recoverStale
};
