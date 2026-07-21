'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const activePath = path.join(root, 'render.yaml');
const templatePath = path.join(root, 'deploy', 'render-production-blueprint.yaml.example');
const active = fs.readFileSync(activePath, 'utf8');
const template = fs.readFileSync(templatePath, 'utf8');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function envBlock(source, key) {
  const marker = new RegExp('^(\\s*)- key: ' + escapeRegex(key) + '\\s*$', 'm');
  const match = marker.exec(source);
  assert(match, 'Blueprint must declare environment key ' + key + '.');
  const rest = source.slice(match.index + match[0].length);
  const next = /\n\s*- key: [A-Z0-9_]+\s*(?:\n|$)/.exec(rest);
  return match[0] + rest.slice(0, next ? next.index : rest.length);
}

function expectValue(key, expected) {
  const block = envBlock(template, key);
  assert(new RegExp('^\\s*value: ["\']?' + escapeRegex(expected) + '["\']?\\s*$', 'm').test(block), key + ' must remain ' + expected + '.');
  assert(!/^\s*sync:\s*false\s*$/m.test(block), key + ' must be a checked non-secret default.');
}

function expectManual(key) {
  const block = envBlock(template, key);
  assert(/^\s*sync:\s*false\s*$/m.test(block), key + ' must require manual Render configuration.');
  assert(!/^\s*value:/m.test(block), key + ' must never contain a committed value.');
}

assert(!/^databases:\s*$/m.test(active), 'The active render.yaml must not create a paid database before owner approval.');
assert(!/- key: (?:DATABASE_URL|WOA_DATA_BACKEND|WOA_PRODUCTION_HARDENING_REQUIRED)\s*$/m.test(active), 'The active render.yaml must not switch the live backend or hardening gate prematurely.');
assert(/REVIEW-ONLY PRODUCTION CUTOVER TEMPLATE/.test(template), 'The production template must carry its review-only warning.');
assert(/Applying this template can create a paid database/.test(template), 'The production template must disclose the paid-resource side effect.');

assert(/^databases:\s*$/m.test(template), 'The production template must declare PostgreSQL.');
assert(/^\s*plan:\s*basic-1gb\s*$/m.test(template), 'The production database must use the reviewed 1 GB paid plan rather than the undersized 256 MB tier.');
assert(/^\s*region:\s*oregon\s*$/m.test(template), 'The production database and service must remain in the current Oregon region.');
assert(/^\s*postgresMajorVersion:\s*["']18["']\s*$/m.test(template), 'The production template must match the PostgreSQL 18 runtime used by the current Render drill.');
assert(/^\s*ipAllowList:\s*\[\]\s*$/m.test(template), 'The production database must reject public Internet connections.');
assert(/^\s*runtime:\s*node\s*$/m.test(template), 'The Render service must use the current node runtime declaration.');

const databaseUrlBlock = envBlock(template, 'DATABASE_URL');
assert(/^\s*fromDatabase:\s*$/m.test(databaseUrlBlock), 'DATABASE_URL must come from the Render database resource.');
assert(/^\s*name:\s*wheelsonauto-postgres\s*$/m.test(databaseUrlBlock), 'DATABASE_URL must target the production database declaration.');
assert(/^\s*property:\s*connectionString\s*$/m.test(databaseUrlBlock), 'DATABASE_URL must use Render\'s private internal connection string.');
assert(!/^\s*(?:value|sync):/m.test(databaseUrlBlock), 'DATABASE_URL must not contain a committed URL or require a manually copied credential.');
assert(!/- key: (?:WOA_TEST_DATABASE_URL|WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL)\s*$/m.test(template), 'Dedicated drill and proof credentials must never remain on the long-running web service.');

[
  ['DATA_DIR', '/var/data'],
  ['WOA_MIGRATION_MAINTENANCE_MODE', '0'],
  ['WOA_POSTGRES_SNAPSHOT_LIMIT', '180'],
  ['WOA_DOCUMENT_STORAGE_PROVIDER', 's3'],
  ['WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED', '1'],
  ['WOA_STATE_BACKUP_ENABLED', '1'],
  ['WOA_PAYMENT_PROVIDER', 'clover'],
  ['WOA_ONBOARDING_PAYMENT_PROVIDER', 'stripe'],
  ['WOA_IDENTITY_PROVIDER', 'stripe'],
  ['WOA_MESSAGING_PROVIDER', 'wheelsonauto'],
  ['WOA_OPTIONAL_CARRIER_SMS_ENABLED', '0'],
  ['WOA_MESSAGING_ENABLED', '1'],
  ['TELNYX_10DLC_USECASE', 'CUSTOMER_CARE'],
  ['WOA_EMAIL_PROVIDER', 'resend'],
  ['WOA_EMAIL_ENABLED', '1'],
  ['WOA_STAR_AI_ENABLED', '1'],
  ['WOA_AI_REPLY_DRAFTS', '1'],
  ['WOA_AI_AUTO_SEND', '0'],
  ['WOA_ERROR_ALERTS_ENABLED', '1']
].forEach(([key, expected]) => expectValue(key, expected));

[
  'WOA_DATA_BACKEND',
  'WOA_PRODUCTION_HARDENING_REQUIRED',
  'WOA_SESSION_SECRET',
  'WOA_DOCUMENT_ENCRYPTION_KEY',
  'WOA_DOCUMENT_ENCRYPTION_KEY_VERSION',
  'WOA_DOCUMENT_DECRYPTION_KEYS',
  'WOA_STATE_BACKUP_ENCRYPTION_KEY',
  'WOA_STATE_BACKUP_KEY_VERSION',
  'WOA_STATE_BACKUP_DECRYPTION_KEYS',
  'WOA_OBJECT_STORAGE_BUCKET',
  'WOA_OBJECT_STORAGE_ENDPOINT',
  'WOA_OBJECT_STORAGE_REGION',
  'WOA_OBJECT_STORAGE_ACCESS_KEY_ID',
  'WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'WOA_OBJECT_STORAGE_PATH_STYLE',
  'CLOVER_ACCESS_TOKEN',
  'CLOVER_ECOMMERCE_PRIVATE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TELNYX_API_KEY',
  'TELNYX_PUBLIC_KEY',
  'TELNYX_MESSAGING_PROFILE_ID',
  'WOA_MESSAGING_FROM_NUMBER',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'WOA_EMAIL_FROM',
  'OPENAI_API_KEY',
  'WOA_AI_MODEL'
].forEach(expectManual);

[
  /postgres(?:ql)?:\/\/[A-Za-z0-9]/i,
  /\bsk_(?:live|test)_/i,
  /\bpk_(?:live|test)_/i,
  /\bwhsec_[A-Za-z0-9]/i,
  /\bre_[A-Za-z0-9]{12,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
].forEach(pattern => {
  assert(!pattern.test(template), 'The production blueprint template must never contain real-looking credentials.');
});

console.log('Render production blueprint check passed: paid PostgreSQL remains review-only, the live blueprint cannot switch early, private networking is required, first-party messaging is primary, optional carrier secrets stay manual, and final cutover gates remain explicit.');
