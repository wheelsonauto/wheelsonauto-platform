'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PROVENANCE_VERSION = 1;
const SOURCE_ORIGIN_CONFIRMATION = 'RENDER_LIVE_DISK';
const MIGRATION_PROVENANCE_CONFIRMATION = 'RENDER_LIVE_DISK_SNAPSHOT';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function validChecksum(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function requiredExpectedChecksum(environment = process.env, variable = 'WOA_POSTGRES_MIGRATION_SOURCE_SHA256') {
  const value = String(environment[variable] || '').trim().toLowerCase();
  if (!validChecksum(value)) {
    throw new Error(variable + ' must be the 64-character SHA-256 printed by postgres-preflight for the exact protected JSON source.');
  }
  return value;
}

function assertExpectedChecksum(actual, expected, label = 'Protected PostgreSQL migration source') {
  const current = String(actual || '').trim().toLowerCase();
  const wanted = String(expected || '').trim().toLowerCase();
  if (current === wanted && validChecksum(current)) return current;
  const error = new Error(label + ' checksum does not match the preflight-confirmed source. Refusing to import or record proof against a changed JSON file.');
  error.code = 'woa_postgres_source_checksum_mismatch';
  throw error;
}

async function readSource(dataFile) {
  const bytes = await fs.readFile(dataFile);
  let state;
  try {
    state = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const wrapped = new Error('Protected PostgreSQL migration source is not valid JSON: ' + String(error && error.message || error));
    wrapped.code = 'woa_postgres_source_invalid_json';
    throw wrapped;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    const error = new Error('Protected PostgreSQL migration source must be a JSON object.');
    error.code = 'woa_postgres_source_invalid_shape';
    throw error;
  }
  return {
    bytes,
    state,
    sourceFileChecksum: sha256(bytes)
  };
}

async function assertSourceUnchanged(dataFile, sourceFileChecksum) {
  const current = await fs.readFile(dataFile);
  return assertExpectedChecksum(sha256(current), sourceFileChecksum, 'Protected PostgreSQL migration source changed while the migration was running');
}

function insideDirectory(rootValue, fileValue) {
  const root = path.resolve(String(rootValue || ''));
  const file = path.resolve(String(fileValue || ''));
  return file === root || file.startsWith(root + path.sep);
}

function serviceId(environment = process.env) {
  return String(environment.RENDER_SERVICE_ID || environment.WOA_SERVICE_ID || '').trim();
}

function sourceCaptureContext(environment = process.env) {
  const dataDirValue = String(environment.DATA_DIR || '').trim();
  const secret = String(environment.WOA_SESSION_SECRET || environment.WOA_COOKIE_SECRET || '');
  const currentServiceId = serviceId(environment);
  if (environment.WOA_POSTGRES_SOURCE_ORIGIN_CONFIRM !== SOURCE_ORIGIN_CONFIRMATION) {
    throw new Error('Set WOA_POSTGRES_SOURCE_ORIGIN_CONFIRM=' + SOURCE_ORIGIN_CONFIRMATION + ' only while capturing the maintenance-frozen Render live disk.');
  }
  if (environment.WOA_MIGRATION_MAINTENANCE_MODE !== '1') {
    throw new Error('WOA_MIGRATION_MAINTENANCE_MODE=1 is required while capturing the live PostgreSQL migration source.');
  }
  if (!dataDirValue) throw new Error('DATA_DIR is required to prove the live Render persistent-disk source.');
  if (!currentServiceId) throw new Error('RENDER_SERVICE_ID or WOA_SERVICE_ID is required to bind the protected source to the current service.');
  if (secret.length < 32) throw new Error('WOA_SESSION_SECRET must contain at least 32 characters to sign the protected-source provenance manifest.');
  return { dataDir: path.resolve(dataDirValue), serviceId: currentServiceId, secret };
}

function provenancePayload(manifest = {}) {
  return JSON.stringify({
    version: Number(manifest.version || 0),
    preparedAt: String(manifest.preparedAt || ''),
    sourceOrigin: String(manifest.sourceOrigin || ''),
    source: path.resolve(String(manifest.source || '')),
    sourceFileChecksum: String(manifest.sourceFileChecksum || '').toLowerCase(),
    protectedCopy: path.resolve(String(manifest.protectedCopy || '')),
    protectedCopyChecksum: String(manifest.protectedCopyChecksum || '').toLowerCase(),
    sourceDataDir: path.resolve(String(manifest.sourceDataDir || '')),
    renderServiceId: String(manifest.renderServiceId || ''),
    maintenanceMode: manifest.maintenanceMode === true,
    policy: String(manifest.policy || ''),
    repairsChecksum: String(manifest.repairsChecksum || '').toLowerCase()
  });
}

function signProvenanceManifest(manifest, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(provenancePayload(manifest), 'utf8').digest('hex');
}

function createProvenanceManifest(details = {}, environment = process.env) {
  const context = sourceCaptureContext(environment);
  const source = path.resolve(String(details.source || ''));
  const protectedCopy = path.resolve(String(details.protectedCopy || ''));
  if (!insideDirectory(context.dataDir, source)) throw new Error('The live source must be inside DATA_DIR. Refusing a developer-checkout or temporary source.');
  if (!insideDirectory(context.dataDir, protectedCopy)) throw new Error('The protected copy must be written inside DATA_DIR so it remains on the controlled Render persistent disk.');
  if (source === protectedCopy) throw new Error('The protected PostgreSQL source must be a separate immutable copy of the live Render data file.');
  if (!validChecksum(details.sourceFileChecksum) || !validChecksum(details.protectedCopyChecksum)) {
    throw new Error('Protected-source provenance requires valid source and protected-copy SHA-256 checksums.');
  }
  const repairsChecksum = sha256(Buffer.from(JSON.stringify(Array.isArray(details.repairs) ? details.repairs : []), 'utf8'));
  const manifest = {
    version: PROVENANCE_VERSION,
    preparedAt: String(details.preparedAt || new Date().toISOString()),
    sourceOrigin: 'render-live-disk',
    source,
    sourceFileChecksum: String(details.sourceFileChecksum).toLowerCase(),
    protectedCopy,
    protectedCopyChecksum: String(details.protectedCopyChecksum).toLowerCase(),
    sourceDataDir: context.dataDir,
    renderServiceId: context.serviceId,
    maintenanceMode: true,
    policy: String(details.policy || ''),
    repairsChecksum
  };
  manifest.signature = {
    algorithm: 'HMAC-SHA256',
    value: signProvenanceManifest(manifest, context.secret)
  };
  return manifest;
}

async function assertProvenanceManifest(dataFile, sourceFileChecksum, environment = process.env) {
  if (environment.WOA_POSTGRES_MIGRATION_PROVENANCE_CONFIRM !== MIGRATION_PROVENANCE_CONFIRMATION) {
    throw new Error('Set WOA_POSTGRES_MIGRATION_PROVENANCE_CONFIRM=' + MIGRATION_PROVENANCE_CONFIRMATION + ' to import only the signed maintenance-frozen Render live-disk snapshot.');
  }
  if (environment.WOA_MIGRATION_MAINTENANCE_MODE !== '1') {
    throw new Error('WOA_MIGRATION_MAINTENANCE_MODE=1 is required while importing or verifying the protected PostgreSQL source.');
  }
  const dataDirValue = String(environment.DATA_DIR || '').trim();
  const currentServiceId = serviceId(environment);
  const secret = String(environment.WOA_SESSION_SECRET || environment.WOA_COOKIE_SECRET || '');
  if (!dataDirValue || !currentServiceId || secret.length < 32) {
    throw new Error('DATA_DIR, RENDER_SERVICE_ID or WOA_SERVICE_ID, and a stable 32-character WOA_SESSION_SECRET are required to verify source provenance.');
  }
  const dataDir = path.resolve(dataDirValue);
  const protectedCopy = path.resolve(dataFile);
  const manifestFile = path.resolve(String(environment.WOA_POSTGRES_MIGRATION_SOURCE_MANIFEST || protectedCopy + '.repair-manifest.json'));
  if (!insideDirectory(dataDir, protectedCopy) || !insideDirectory(dataDir, manifestFile)) {
    throw new Error('Protected PostgreSQL source and provenance manifest must both remain inside DATA_DIR.');
  }
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = await fs.readFile(manifestFile);
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error('Could not read the signed PostgreSQL source provenance manifest: ' + String(error && error.message || error));
  }
  if (Number(manifest.version) !== PROVENANCE_VERSION || manifest.sourceOrigin !== 'render-live-disk' || manifest.maintenanceMode !== true) {
    throw new Error('The PostgreSQL source provenance manifest was not created from a maintenance-frozen Render live disk.');
  }
  const manifestSource = path.resolve(String(manifest.source || ''));
  if (!insideDirectory(dataDir, manifestSource)
    || path.resolve(String(manifest.protectedCopy || '')) !== protectedCopy
    || path.resolve(String(manifest.sourceDataDir || '')) !== dataDir) {
    throw new Error('The PostgreSQL source provenance manifest belongs to a different protected copy or data directory.');
  }
  if (manifestSource === protectedCopy) throw new Error('The signed PostgreSQL provenance does not identify a separate live source and protected copy.');
  if (String(manifest.renderServiceId || '') !== currentServiceId) {
    throw new Error('The PostgreSQL source provenance manifest belongs to a different Render service.');
  }
  if (!validChecksum(manifest.sourceFileChecksum) || !validChecksum(manifest.protectedCopyChecksum)) {
    throw new Error('The PostgreSQL source provenance manifest contains an invalid checksum.');
  }
  assertExpectedChecksum(sourceFileChecksum, manifest.protectedCopyChecksum, 'Protected copy does not match its signed provenance manifest');
  const manifestRepairsChecksum = sha256(Buffer.from(JSON.stringify(Array.isArray(manifest.repairs) ? manifest.repairs : []), 'utf8'));
  assertExpectedChecksum(manifestRepairsChecksum, manifest.repairsChecksum, 'Protected-source repair evidence does not match its signed provenance manifest');
  const preparedAt = Date.parse(String(manifest.preparedAt || ''));
  const configuredMaxAge = environment.WOA_POSTGRES_MIGRATION_SOURCE_MAX_AGE_MS === undefined
    ? 6 * 60 * 60 * 1000
    : Number(environment.WOA_POSTGRES_MIGRATION_SOURCE_MAX_AGE_MS);
  if (!Number.isFinite(configuredMaxAge) || configuredMaxAge < 60_000 || configuredMaxAge > 24 * 60 * 60 * 1000) {
    throw new Error('WOA_POSTGRES_MIGRATION_SOURCE_MAX_AGE_MS must be between 60000 and 86400000 milliseconds.');
  }
  const maxAgeMs = configuredMaxAge;
  if (!Number.isFinite(preparedAt) || preparedAt > Date.now() + 5 * 60 * 1000 || Date.now() - preparedAt > maxAgeMs) {
    throw new Error('The protected PostgreSQL source provenance is stale or has an invalid capture time. Capture a fresh live-disk snapshot while maintenance mode is active.');
  }
  const actualSignature = String(manifest.signature && manifest.signature.value || '');
  const expectedSignature = signProvenanceManifest(manifest, secret);
  const actualBytes = Buffer.from(actualSignature, 'hex');
  const expectedBytes = Buffer.from(expectedSignature, 'hex');
  if (String(manifest.signature && manifest.signature.algorithm || '') !== 'HMAC-SHA256' || actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error('The protected PostgreSQL source provenance signature is invalid. Refusing a copied or modified snapshot.');
  }
  return {
    version: Number(manifest.version),
    manifestFile,
    manifestChecksum: sha256(manifestBytes),
    signatureChecksum: sha256(Buffer.from(actualSignature, 'utf8')),
    preparedAt: new Date(preparedAt).toISOString(),
    sourceOrigin: manifest.sourceOrigin,
    sourceFileChecksum: manifest.sourceFileChecksum,
    protectedCopyChecksum: manifest.protectedCopyChecksum,
    renderServiceId: manifest.renderServiceId
  };
}

module.exports = {
  sha256,
  validChecksum,
  requiredExpectedChecksum,
  assertExpectedChecksum,
  readSource,
  assertSourceUnchanged,
  createProvenanceManifest,
  assertProvenanceManifest,
  SOURCE_ORIGIN_CONFIRMATION,
  MIGRATION_PROVENANCE_CONFIRMATION
};
