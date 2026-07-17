'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');

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

module.exports = {
  sha256,
  validChecksum,
  requiredExpectedChecksum,
  assertExpectedChecksum,
  readSource,
  assertSourceUnchanged
};
