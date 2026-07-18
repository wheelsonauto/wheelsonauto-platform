'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_LOCK_NAME = '.woa-postgres-migration.lock';

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

module.exports = {
  DEFAULT_LOCK_NAME,
  lockFilePath,
  lockStatus,
  assertWritesAllowed,
  acquire,
  release
};
