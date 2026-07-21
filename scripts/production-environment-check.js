'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { productionEnvironmentReport } = require('../production-environment');

function readyEnvironment() {
  return {
    WOA_DATA_BACKEND: 'postgres',
    DATABASE_URL: 'postgresql://wheelsonauto:secret@private-postgres.internal:5432/wheelsonauto',
    WOA_POSTGRES_SNAPSHOT_LIMIT: '180',
    WOA_MIGRATION_MAINTENANCE_MODE: '0',
    WOA_DOCUMENT_STORAGE_PROVIDER: 's3',
    WOA_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    WOA_DOCUMENT_ENCRYPTION_KEY_VERSION: 'documents-v1',
    WOA_OBJECT_STORAGE_BUCKET: 'wheelsonauto-private-documents',
    WOA_OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    WOA_OBJECT_STORAGE_ACCESS_KEY_ID: 'object-access-key-id',
    WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'object-secret-access-key',
    WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED: '1',
    WOA_STATE_BACKUP_ENABLED: '1',
    WOA_STATE_BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    WOA_STATE_BACKUP_KEY_VERSION: 'state-v1',
    STRIPE_SECRET_KEY: ['rk', 'live', 'environmentcheck'].join('_'),
    STRIPE_PUBLISHABLE_KEY: ['pk', 'live', 'environmentcheck'].join('_'),
    STRIPE_WEBHOOK_SECRET: 'whsec_environmentcheck',
    WOA_PAYMENT_PROVIDER: 'clover',
    WOA_ONBOARDING_PAYMENT_PROVIDER: 'stripe',
    WOA_IDENTITY_PROVIDER: 'stripe',
    WOA_MESSAGING_PROVIDER: 'wheelsonauto',
    WOA_MESSAGING_ENABLED: '1',
    WOA_EMAIL_PROVIDER: 'resend',
    WOA_EMAIL_ENABLED: '1',
    RESEND_API_KEY: 're_environment_check',
    RESEND_WEBHOOK_SECRET: 'whsec_resend_environment_check',
    WOA_EMAIL_FROM: 'WheelsonAuto <notifications@notify.wheelsonauto.com>',
    OPENAI_API_KEY: 'project-environment-check',
    WOA_AI_MODEL: 'gpt-environment-check',
    WOA_STAR_AI_ENABLED: '1',
    WOA_AI_REPLY_DRAFTS: '1',
    WOA_AI_AUTO_SEND: '0',
    WOA_AI_MAX_REQUESTS_PER_DAY: '250',
    WOA_AI_MAX_REQUESTS_PER_MONTH: '2500',
    WOA_SESSION_SECRET: 'stable-session-secret-environment-check',
    PUBLIC_BASE_URL: 'https://wheelsonauto.com',
    WOA_ERROR_ALERTS_ENABLED: '1',
    WOA_PRODUCTION_HARDENING_REQUIRED: '1'
  };
}

function main() {
  const ready = readyEnvironment();
  const report = productionEnvironmentReport(ready);
  assert.strictEqual(report.ready, true, 'A complete controlled-cutover environment must pass.');
  assert.strictEqual(report.missing.length, 0, 'A complete environment must not report missing keys.');

  const standardLiveStripeKey = productionEnvironmentReport({
    ...ready,
    STRIPE_SECRET_KEY: ['sk', 'live', 'environmentcheck'].join('_')
  });
  assert(!standardLiveStripeKey.missing.includes('STRIPE_SECRET_KEY'), 'A standard Stripe live secret key must remain supported.');

  const unsafe = productionEnvironmentReport({
    ...ready,
    DATABASE_URL: 'postgresql://wheelsonauto:secret@public-database.render.com:5432/wheelsonauto',
    WOA_TEST_DATABASE_URL: ready.DATABASE_URL,
    WOA_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    WOA_STATE_BACKUP_ENCRYPTION_KEY: ready.WOA_DOCUMENT_ENCRYPTION_KEY,
    STRIPE_SECRET_KEY: ['sk', 'test', 'environmentcheck'].join('_'),
    STRIPE_PUBLISHABLE_KEY: ['pk', 'test', 'environmentcheck'].join('_'),
    WOA_PAYMENT_PROVIDER: 'stripe',
    WOA_AI_MAX_REQUESTS_PER_MONTH: '10',
    WOA_MESSAGING_ENABLED: '0',
    WOA_AI_AUTO_SEND: '1'
  });
  ['DATABASE_NETWORK_SCOPE', 'WOA_TEST_DATABASE_URL', 'WOA_OBJECT_STORAGE_ENDPOINT', 'WOA_STATE_BACKUP_KEY_ISOLATION', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'WOA_PAYMENT_PROVIDER', 'WOA_MESSAGING_ENABLED', 'WOA_AI_AUTO_SEND', 'WOA_AI_MAX_REQUESTS_PER_MONTH'].forEach(key => {
    assert(unsafe.missing.includes(key), 'Unsafe production configuration must identify ' + key + '.');
  });
  assert.strictEqual(unsafe.ready, false, 'Unsafe production configuration must fail closed.');

  const restrictedTestStripeKey = productionEnvironmentReport({
    ...ready,
    STRIPE_SECRET_KEY: ['rk', 'test', 'environmentcheck'].join('_')
  });
  assert(restrictedTestStripeKey.missing.includes('STRIPE_SECRET_KEY'), 'A restricted Stripe test key must never pass the production gate.');

  const publicR2 = productionEnvironmentReport({
    ...ready,
    WOA_OBJECT_STORAGE_ENDPOINT: 'https://pub-wheelsonauto.r2.dev'
  });
  assert(publicR2.missing.includes('WOA_OBJECT_STORAGE_ENDPOINT'), 'A public R2 delivery endpoint must never qualify as private document storage.');

  const credentialedStorageUrl = productionEnvironmentReport({
    ...ready,
    WOA_OBJECT_STORAGE_ENDPOINT: 'https://access:secret@account.r2.cloudflarestorage.com'
  });
  assert(credentialedStorageUrl.missing.includes('WOA_OBJECT_STORAGE_ENDPOINT'), 'Object-storage credentials must remain separate from the endpoint URL.');

  const empty = productionEnvironmentReport({});
  assert.strictEqual(empty.ready, false, 'An empty environment must not be launch-ready.');
  assert(empty.missing.includes('DATABASE_URL') && empty.missing.includes('WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED') && empty.missing.includes('WOA_PRODUCTION_HARDENING_REQUIRED'), 'An empty report must name the critical launch controls.');

  const serialized = JSON.stringify(unsafe);
  Object.values(ready).filter(secret => /secret|key|postgresql|project-environment/i.test(secret)).forEach(secret => {
    assert(!serialized.includes(secret), 'The environment report must never serialize configured secret values.');
  });
  assert.deepStrictEqual(Object.keys(report.checks[0]).sort(), ['key', 'message', 'ready'], 'Environment checks may expose only key name, status, and guidance.');

  const withoutTelnyx = productionEnvironmentReport({
    ...ready,
    WOA_MESSAGING_PROVIDER: 'wheelsonauto',
    TELNYX_API_KEY: '',
    TELNYX_PUBLIC_KEY: '',
    TELNYX_MESSAGING_PROFILE_ID: '',
    WOA_MESSAGING_FROM_NUMBER: '',
    TELNYX_10DLC_USECASE: ''
  });
  assert.strictEqual(withoutTelnyx.ready, true, 'Optional carrier SMS credentials must not block first-party messaging or the Stripe launch.');

  console.log('Production environment check passed: private database networking, private S3 API storage, isolated backup keys, live Stripe, first-party messaging, Resend, guarded Star limits, alerts, and hardened controlled-cutover settings fail closed without requiring optional carrier SMS or exposing secret values.');
}

main();
