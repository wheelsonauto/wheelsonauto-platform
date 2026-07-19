'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const LEASE_FORMAT = 'wheelsonauto-migration-maintenance-lease';
const LEASE_VERSION = 1;
const LEASE_FILENAME = '.wheelsonauto-migration-maintenance-lease.json';
const DEFAULT_MAX_AGE_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 30_000;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function leasePath(dataDir) {
  return path.join(path.resolve(dataDir || process.env.DATA_DIR || process.cwd()), LEASE_FILENAME);
}

function context(options = {}) {
  const environment = options.environment || process.env;
  const dataDir = path.resolve(options.dataDir || environment.DATA_DIR || '');
  const serviceId = String(options.serviceId || environment.RENDER_SERVICE_ID || environment.WOA_SERVICE_ID || '').trim();
  const renderCommit = String(options.renderCommit || environment.RENDER_GIT_COMMIT || environment.WOA_DEPLOY_COMMIT || '').trim();
  const secret = String(options.secret || environment.WOA_SESSION_SECRET || environment.WOA_COOKIE_SECRET || '');
  if (!String(options.dataDir || environment.DATA_DIR || '').trim()) throw new Error('DATA_DIR is required for the shared migration-maintenance lease.');
  if (!serviceId) throw new Error('RENDER_SERVICE_ID or WOA_SERVICE_ID is required for the shared migration-maintenance lease.');
  if (!renderCommit) throw new Error('RENDER_GIT_COMMIT or WOA_DEPLOY_COMMIT is required for the shared migration-maintenance lease.');
  if (secret.length < 32) throw new Error('WOA_SESSION_SECRET must contain at least 32 characters for the signed migration-maintenance lease.');
  return { dataDir, serviceId, renderCommit, secret };
}

function isConfigured(options = {}) {
  try {
    context(options);
    return true;
  } catch {
    return false;
  }
}

function leasePayload(record = {}) {
  return JSON.stringify({
    format: String(record.format || ''),
    version: Number(record.version || 0),
    maintenanceMode: record.maintenanceMode === true,
    serviceId: String(record.serviceId || ''),
    renderCommit: String(record.renderCommit || ''),
    instanceId: String(record.instanceId || ''),
    startedAt: String(record.startedAt || ''),
    heartbeatAt: String(record.heartbeatAt || '')
  });
}

function signLease(record, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(leasePayload(record), 'utf8').digest('hex');
}

function timingSafeHexEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ''), 'hex');
  const rightBytes = Buffer.from(String(right || ''), 'hex');
  return leftBytes.length > 0 && leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

async function writeAtomic(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
  try {
    await fs.writeFile(temporary, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function publishLease(options = {}) {
  const current = context(options);
  const now = new Date(options.now || Date.now()).toISOString();
  const record = {
    format: LEASE_FORMAT,
    version: LEASE_VERSION,
    maintenanceMode: options.maintenanceMode === true,
    serviceId: current.serviceId,
    renderCommit: current.renderCommit,
    instanceId: String(options.instanceId || crypto.randomBytes(24).toString('hex')),
    startedAt: String(options.startedAt || now),
    heartbeatAt: now
  };
  record.signature = { algorithm: 'HMAC-SHA256', value: signLease(record, current.secret) };
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n', 'utf8');
  await writeAtomic(leasePath(current.dataDir), bytes);
  return { ...record, leaseChecksum: sha256(bytes), signatureChecksum: sha256(Buffer.from(record.signature.value, 'utf8')) };
}

async function readLease(options = {}) {
  const current = context(options);
  const file = leasePath(current.dataDir);
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('The deployed Render service has not published a migration-maintenance lease.');
    throw error;
  }
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('The shared migration-maintenance lease is unreadable.');
  }
  if (record.format !== LEASE_FORMAT || Number(record.version) !== LEASE_VERSION) throw new Error('The shared migration-maintenance lease format is invalid.');
  const signature = String(record.signature && record.signature.value || '');
  const expected = signLease(record, current.secret);
  if (String(record.signature && record.signature.algorithm || '') !== 'HMAC-SHA256' || !timingSafeHexEqual(signature, expected)) {
    throw new Error('The shared migration-maintenance lease signature is invalid.');
  }
  return { record, bytes, context: current, file, signature };
}

async function assertActiveLease(options = {}) {
  const checked = await readLease(options);
  const { record, context: current } = checked;
  if (record.maintenanceMode !== true) throw new Error('The deployed Render service is not in migration maintenance mode.');
  if (String(record.serviceId || '') !== current.serviceId) throw new Error('The migration-maintenance lease belongs to a different Render service.');
  if (String(record.renderCommit || '') !== current.renderCommit) throw new Error('The migration-maintenance lease belongs to a different deployed commit.');
  if (!/^[a-f0-9]{32,128}$/i.test(String(record.instanceId || ''))) throw new Error('The migration-maintenance lease instance identity is invalid.');
  const startedAt = Date.parse(String(record.startedAt || ''));
  const heartbeatAt = Date.parse(String(record.heartbeatAt || ''));
  const configuredMaxAge = options.maxAgeMs === undefined
    ? Number((options.environment || process.env).WOA_MIGRATION_MAINTENANCE_LEASE_MAX_AGE_MS || DEFAULT_MAX_AGE_MS)
    : Number(options.maxAgeMs);
  if (!Number.isFinite(configuredMaxAge) || configuredMaxAge < 30_000 || configuredMaxAge > 10 * 60_000) {
    throw new Error('WOA_MIGRATION_MAINTENANCE_LEASE_MAX_AGE_MS must be between 30000 and 600000 milliseconds.');
  }
  const now = Number(options.now || Date.now());
  if (!Number.isFinite(startedAt) || !Number.isFinite(heartbeatAt) || heartbeatAt < startedAt || heartbeatAt > now + 30_000 || now - heartbeatAt > configuredMaxAge) {
    throw new Error('The deployed Render migration-maintenance lease is stale or has an invalid heartbeat.');
  }
  return {
    serviceId: current.serviceId,
    renderCommit: current.renderCommit,
    instanceId: String(record.instanceId),
    startedAt: new Date(startedAt).toISOString(),
    heartbeatAt: new Date(heartbeatAt).toISOString(),
    leaseChecksum: sha256(checked.bytes),
    signatureChecksum: sha256(Buffer.from(checked.signature, 'utf8'))
  };
}

function createLeaseController(options = {}) {
  const environment = options.environment || process.env;
  const maintenanceMode = options.maintenanceMode === true;
  const instanceId = crypto.randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();
  const heartbeatMs = Math.max(10_000, Math.min(60_000, Number(environment.WOA_MIGRATION_MAINTENANCE_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS)));
  let timer = null;
  let started = false;
  let publishQueue = Promise.resolve();
  const publish = () => {
    publishQueue = publishQueue.catch(() => {}).then(() => publishLease({ ...options, environment, maintenanceMode, instanceId, startedAt }));
    return publishQueue;
  };
  return {
    async start() {
      const first = await publish();
      started = true;
      if (maintenanceMode) {
        timer = setInterval(() => { void publish().catch(error => console.error('Migration-maintenance lease heartbeat failed:', error.message || error)); }, heartbeatMs);
        timer.unref();
      }
      return first;
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await publishQueue.catch(() => {});
      if (!started || !maintenanceMode) return { invalidated: false };
      started = false;
      const checked = await readLease({ ...options, environment }).catch(() => null);
      if (!checked || String(checked.record.instanceId || '') !== instanceId || String(checked.record.renderCommit || '') !== context({ ...options, environment }).renderCommit) {
        return { invalidated: false };
      }
      await publishLease({ ...options, environment, maintenanceMode: false, instanceId, startedAt });
      return { invalidated: true };
    }
  };
}

module.exports = {
  LEASE_FORMAT,
  LEASE_VERSION,
  LEASE_FILENAME,
  DEFAULT_MAX_AGE_MS,
  leasePath,
  isConfigured,
  publishLease,
  readLease,
  assertActiveLease,
  createLeaseController
};
