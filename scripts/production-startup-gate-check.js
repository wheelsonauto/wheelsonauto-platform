'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function cleanRuntimeEnvironment(dataDir) {
  const password = 'OwnerPassword123!';
  const salt = 'startup-gate-owner-password-salt';
  const passwordHash = 'pbkdf2$310000$' + crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');

  // Do not inherit provider credentials. This must prove the gate fails when
  // infrastructure is absent, even on a developer machine with local secrets.
  return {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || '',
    LANG: process.env.LANG || 'en_US.UTF-8',
    DATA_DIR: dataDir,
    PORT: '0',
    WOA_DATA_BACKEND: 'json',
    WOA_PRODUCTION_HARDENING_REQUIRED: '1',
    WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED: '1',
    WOA_OWNER_PIN_FALLBACK_ENABLED: '0',
    WOA_ADMIN_USERNAME: 'owner',
    WOA_ADMIN_PASSWORD_HASH: passwordHash,
    WOA_ADMIN_PASSWORD_SALT: salt,
    WOA_SESSION_SECRET: 'startup-gate-session-secret-must-be-stable',
    PUBLIC_BASE_URL: 'https://wheelsonauto.test',
    WOA_AUTO_SYNC_MS: '3600000',
    WOA_AUTOPAY_MS: '3600000',
    WOA_AUTO_SYNC_STARTUP_DELAY_MS: '3600000',
    DATABASE_URL: '',
    STRIPE_SECRET_KEY: '',
    WOA_STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    WOA_STRIPE_WEBHOOK_SECRET: '',
    WOA_DOCUMENT_STORAGE_PROVIDER: 'local',
    WOA_DOCUMENT_ENCRYPTION_KEY: '',
    WOA_OBJECT_STORAGE_BUCKET: '',
    WOA_OBJECT_STORAGE_ENDPOINT: '',
    WOA_OBJECT_STORAGE_ACCESS_KEY_ID: '',
    WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY: '',
    WOA_ERROR_ALERTS_ENABLED: '0',
    RESEND_API_KEY: '',
    WOA_RESEND_API_KEY: '',
    SENDGRID_API_KEY: '',
    WOA_SENDGRID_API_KEY: '',
    WOA_IDENTITY_PROVIDER: 'manual'
  };
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-production-startup-gate-'));
  try {
    const result = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: cleanRuntimeEnvironment(dataDir),
      encoding: 'utf8',
      timeout: 10000
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('');

    assert.ifError(result.error);
    assert.strictEqual(result.signal, null, 'The startup gate must exit cleanly instead of hanging or being terminated.');
    assert.strictEqual(result.status, 1, 'Hardened mode with incomplete infrastructure must refuse to start the HTTP server.');
    assert.match(output, /WheelsonAuto refused to start with incomplete production safeguards/i, 'The startup failure must clearly identify the production guard.');
    assert.match(output, /PostgreSQL transactional state/i, 'The startup guard must require transactional PostgreSQL.');
    assert.match(output, /S3-compatible AES-256-GCM private document storage/i, 'The startup guard must require encrypted private object storage.');
    assert.match(output, /Stripe live secret key/i, 'The startup guard must require live Stripe credentials.');
    assert(!/WheelsonAuto platform running/i.test(output), 'The HTTP listener must never start when required safeguards are incomplete.');

    console.log('Production startup gate check passed: hardened mode refuses to listen until transactional state, encrypted private storage, and signed live payment safeguards are ready.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
