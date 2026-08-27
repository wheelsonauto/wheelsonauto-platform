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
    WOA_MESSAGING_ENABLED: '0',
    RESEND_API_KEY: '',
    WOA_RESEND_API_KEY: '',
    SENDGRID_API_KEY: '',
    WOA_SENDGRID_API_KEY: '',
    WOA_IDENTITY_PROVIDER: 'manual',
    WOA_ONBOARDING_PAYMENT_PROVIDER: 'clover'
  };
}

async function main() {
  const serverSource = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(serverSource, /const startupMissing = preflight\.providerProofCollection[\s\S]*?preflight\.providerProofCollection\.missing/, 'Runtime startup must be gated by durable foundation readiness, not expiring provider evidence.');
  assert.match(serverSource, /durable runtime safeguards are incomplete:[\s\S]*?startupMissing\.join/, 'A startup refusal must report only the durable runtime blockers that actually stopped the server.');
  assert(!/stateBackup\.verified \|\| !stateBackup\.fresh\) providerProofCollectionMissing/.test(serverSource), 'An expired backup freshness window must lock launch actions without taking the application offline.');
  assert(!/documentStorage\.productionReady \|\| !documentStorageValidation\.live[\s\S]*?providerProofCollectionMissing/.test(serverSource), 'Expired object-storage probe evidence must lock protected actions without taking the application offline.');
  for (const providerWarning of [
    'private object storage write/read/private/immutable/delete proof',
    'signed live Stripe Identity verification',
    'Resend wheelsonauto.com two-way email proof',
    'OpenAI Star Responses API health proof with active safety limits'
  ]) {
    assert(serverSource.includes("missing.push('" + providerWarning + "')"), providerWarning + ' must remain a protected launch-action gate.');
  }
  assert.match(serverSource, /stripeLaunchLocked:\s*!preflight\.readyForLiveStripe/, 'An available runtime must keep Stripe launch locked while provider or cutover evidence is incomplete.');
  assert.match(serverSource, /refreshRecoveryDrillForProductionStartup[\s\S]*?WOA_LIVE_RENDER_PRODUCTION[\s\S]*?STATE_REPOSITORY\.kind !== 'postgres'/, 'Only the exact PostgreSQL-backed WheelsonAuto production service may refresh recovery proof at startup.');
  assert.match(serverSource, /WOA_POSTGRES_RECOVERY_DRILL_CONFIRM:\s*postgresRecoveryDrill\.CONFIRMATION_PHRASE/, 'The automated production refresh must still use the guarded isolated-drill confirmation contract.');
  assert.match(serverSource, /WOA_POSTGRES_RUNTIME_PROOF_ORGANIZATION_ID:\s*MAIN_ORG_ID/, 'Recovery proof must be written to the same organization used by production readiness.');
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
    assert.match(output, /durable runtime safeguards are incomplete/i, 'The startup failure must distinguish durable runtime blockers from expiring provider proof warnings.');
    assert.match(output, /PostgreSQL transactional state/i, 'The startup guard must require transactional PostgreSQL.');
    assert.match(output, /database credential isolation/i, 'The startup guard must reject a web service that retains the dedicated drill database credential.');
    assert.match(output, /controlled PostgreSQL recovery drill/i, 'The startup guard must require a fresh controlled PostgreSQL restore and restart drill.');
    assert.match(output, /verified encrypted offsite state backup/i, 'The startup guard must require enabled, dedicated, production-ready backup storage with an authenticated read-back.');
    assert.match(output, /production-ready encrypted private storage/i, 'The startup guard must require encrypted private object storage, key coverage, and private-artifact coverage.');
    assert(!/Stripe live secret key/i.test(output), 'Missing provider credentials must lock provider actions without taking the application offline once the durable runtime is ready.');
    assert(!/Stripe onboarding payment provider/i.test(output), 'Payment-provider rollout configuration must remain an action gate, not an application availability gate.');
    assert(!/Stripe Identity provider/i.test(output), 'Identity-provider rollout configuration must remain an action gate, not an application availability gate.');
    assert(!/verified operational error alert delivery/i.test(output), 'Expired provider alert proof must not replace the durable runtime failure reason.');
    assert(!/WheelsonAuto first-party messaging enabled on PostgreSQL/i.test(output), 'First-party messaging launch evidence must not replace the durable runtime failure reason.');
    assert(!/Telnyx signed SMS delivery and inbound reply proof/i.test(output), 'Optional carrier SMS must not block the first-party customer-app launch.');
    assert(!/Resend wheelsonauto\.com two-way email proof/i.test(output), 'Expired Resend proof must lock email automation without taking the application offline.');
    assert(!/OpenAI Star Responses API health proof with active safety limits/i.test(output), 'Expired Star proof must lock AI automation without taking the application offline.');
    assert(!/fresh Clover recurring roster for controlled cutover/i.test(output), 'A stale Clover roster must lock cutover without taking the application offline.');
    assert(!/WheelsonAuto platform running/i.test(output), 'The HTTP listener must never start when required safeguards are incomplete.');

    const identityRuntimeResult = spawnSync(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...cleanRuntimeEnvironment(dataDir), WOA_IDENTITY_PROVIDER: 'stripe', WOA_ONBOARDING_PAYMENT_PROVIDER: 'stripe' },
      encoding: 'utf8',
      timeout: 10000
    });
    const identityRuntimeOutput = [identityRuntimeResult.stdout, identityRuntimeResult.stderr].filter(Boolean).join('');
    assert.ifError(identityRuntimeResult.error);
    assert.strictEqual(identityRuntimeResult.status, 1, 'The fixture must still refuse startup because its durable database, backup, storage, and access foundation is incomplete.');
    assert(!/Stripe Identity live runtime/i.test(identityRuntimeOutput), 'Stripe Identity readiness must not obscure the durable startup blocker.');
    assert(!/signed live Stripe Identity verification/i.test(identityRuntimeOutput), 'Expired Stripe Identity proof must remain a feature gate instead of an availability gate.');
    assert(!/WheelsonAuto platform running/i.test(identityRuntimeOutput), 'The HTTP listener must never start while durable runtime safeguards are incomplete.');

    console.log('Production startup gate check passed: hardened mode refuses to listen until durable transactional state, controlled recovery, verified encrypted offsite backup configuration, encrypted private storage, signed sessions, owner access, and HTTPS are ready; expiring provider proof locks only its protected actions.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
