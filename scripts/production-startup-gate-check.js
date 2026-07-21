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
    WOA_TEST_DATABASE_URL: 'postgres://drill-only:drill-only@127.0.0.1:5432/wheelsonauto-drill',
    STRIPE_SECRET_KEY: '',
    WOA_STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    WOA_STRIPE_WEBHOOK_SECRET: '',
    WOA_DOCUMENT_STORAGE_PROVIDER: 'local',
    WOA_DOCUMENT_ENCRYPTION_KEY: '',
    WOA_STATE_BACKUP_ENABLED: '0',
    WOA_STATE_BACKUP_ENCRYPTION_KEY: '',
    WOA_OBJECT_STORAGE_BUCKET: '',
    WOA_OBJECT_STORAGE_ENDPOINT: '',
    WOA_OBJECT_STORAGE_ACCESS_KEY_ID: '',
    WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY: '',
    WOA_ERROR_ALERTS_ENABLED: '0',
    RESEND_API_KEY: '',
    WOA_RESEND_API_KEY: '',
    SENDGRID_API_KEY: '',
    WOA_SENDGRID_API_KEY: '',
    WOA_IDENTITY_PROVIDER: 'manual',
    WOA_ONBOARDING_PAYMENT_PROVIDER: 'clover'
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
    assert.match(output, /remove dedicated PostgreSQL drill credentials from the production web runtime/i, 'The startup guard must reject a web service that retains the dedicated drill database credential.');
    assert.match(output, /controlled PostgreSQL recovery drill/i, 'The startup guard must require a fresh controlled PostgreSQL restore and restart drill.');
    assert.match(output, /WOA_STATE_BACKUP_ENABLED=1/i, 'The startup guard must require the scheduled encrypted state-backup worker.');
    assert.match(output, /HTTPS offsite encrypted state-backup storage/i, 'The startup guard must require independent HTTPS offsite backup storage.');
    assert.match(output, /dedicated WOA_STATE_BACKUP_ENCRYPTION_KEY/i, 'The startup guard must require a separate state-backup encryption key.');
    assert.match(output, /verified encrypted offsite state backup/i, 'The startup guard must require an authenticated backup read-back before launch.');
    assert.match(output, /S3-compatible AES-256-GCM private document storage/i, 'The startup guard must require encrypted private object storage.');
    assert.match(output, /Stripe live secret key/i, 'The startup guard must require live Stripe credentials.');
    assert.match(output, /Stripe onboarding payment provider/i, 'The startup guard must reject a live Stripe launch that still creates new onboarding payments through Clover.');
    assert.match(output, /Stripe Identity provider/i, 'The startup guard must reject a live Stripe launch that falls back to manual identity verification.');
    assert.match(output, /verified operational error alert delivery/i, 'The startup guard must require a verified owner alert route for failed jobs, webhooks, and autopay runs.');
    assert(!/Telnyx signed SMS delivery and inbound reply proof/i.test(output), 'Optional carrier SMS must not block the first-party customer-app launch.');
    assert.match(output, /Resend wheelsonauto\.com two-way email proof/i, 'The startup guard must require a verified WheelsonAuto sender and signed two-way Resend proof.');
    assert.match(output, /OpenAI Star Responses API health proof with active safety limits/i, 'The startup guard must require a fresh Star provider proof with configured request caps.');
    assert.match(output, /fresh Clover recurring roster for controlled cutover/i, 'The startup guard must reject a Stripe launch that relies on a missing or degraded Clover recurring roster.');
    assert(!/WheelsonAuto platform running/i.test(output), 'The HTTP listener must never start when required safeguards are incomplete.');

    const identityRuntimeResult = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...cleanRuntimeEnvironment(dataDir), WOA_IDENTITY_PROVIDER: 'stripe', WOA_ONBOARDING_PAYMENT_PROVIDER: 'stripe' },
      encoding: 'utf8',
      timeout: 10000
    });
    const identityRuntimeOutput = [identityRuntimeResult.stdout, identityRuntimeResult.stderr].filter(Boolean).join('');
    assert.ifError(identityRuntimeResult.error);
    assert.strictEqual(identityRuntimeResult.status, 1, 'Stripe Identity must still block startup until its own live verification proof is complete.');
    assert.match(identityRuntimeOutput, /Stripe Identity live runtime/i, 'The startup guard must reject a Stripe Identity configuration without a usable live runtime.');
    assert.match(identityRuntimeOutput, /signed live Stripe Identity verification/i, 'The startup guard must require a signed verified Stripe Identity event from a WheelsonAuto onboarding record.');
    assert(!/WheelsonAuto platform running/i.test(identityRuntimeOutput), 'The HTTP listener must never start while Stripe Identity proof is incomplete.');

    console.log('Production startup gate check passed: hardened mode refuses to listen until transactional state, controlled recovery, a fresh encrypted offsite backup, encrypted private storage, Stripe onboarding and Identity proof, Resend, Star, signed live payment safeguards, and failure-alert delivery are ready; carrier SMS stays optional.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
