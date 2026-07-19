'use strict';

const { decodeEncryptionKey } = require('./secure-document-store');

function value(env, ...names) {
  for (const name of names) {
    const candidate = String(env && env[name] || '').trim();
    if (candidate) return candidate;
  }
  return '';
}

function enabled(env, name) {
  return value(env, name) === '1';
}

function validHttps(valueToCheck) {
  try {
    const parsed = new URL(String(valueToCheck || ''));
    return parsed.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function validPrivateObjectStorageEndpoint(valueToCheck) {
  try {
    const parsed = new URL(String(valueToCheck || ''));
    if (!validHttps(valueToCheck) || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'r2.dev' || hostname.endsWith('.r2.dev')) return false;
    return true;
  } catch {
    return false;
  }
}

function validPostgresUrl(valueToCheck) {
  try {
    const parsed = new URL(String(valueToCheck || ''));
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) && !!parsed.hostname && !!parsed.pathname.replace(/^\/+/, '');
  } catch {
    return false;
  }
}

function validPrivatePostgresUrl(valueToCheck) {
  try {
    const parsed = new URL(String(valueToCheck || ''));
    if (!validPostgresUrl(valueToCheck)) return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || ['localhost', '127.0.0.1', '::1'].includes(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
    return !hostname.includes('.') || hostname.endsWith('.internal') || hostname.endsWith('.private') || hostname.endsWith('.svc') || hostname.endsWith('.cluster.local');
  } catch {
    return false;
  }
}

function validEmailSender(valueToCheck) {
  const match = String(valueToCheck || '').match(/(?:^|<)([^<>\s]+@[^<>\s]+)(?:>|$)/);
  if (!match) return false;
  const domain = match[1].split('@')[1].toLowerCase();
  return domain === 'wheelsonauto.com' || domain.endsWith('.wheelsonauto.com');
}

function productionEnvironmentReport(env = {}) {
  const checks = [];
  const add = (key, ready, message) => checks.push({ key, ready: ready === true, message });
  const documentKey = decodeEncryptionKey(value(env, 'WOA_DOCUMENT_ENCRYPTION_KEY'));
  const backupKey = decodeEncryptionKey(value(env, 'WOA_STATE_BACKUP_ENCRYPTION_KEY'));
  const stripeSecret = value(env, 'STRIPE_SECRET_KEY', 'WOA_STRIPE_SECRET_KEY');
  const stripePublishable = value(env, 'STRIPE_PUBLISHABLE_KEY', 'WOA_STRIPE_PUBLISHABLE_KEY');
  const stripeWebhook = value(env, 'STRIPE_WEBHOOK_SECRET', 'WOA_STRIPE_WEBHOOK_SECRET');
  const dailyAiLimit = Number(value(env, 'WOA_AI_MAX_REQUESTS_PER_DAY'));
  const monthlyAiLimit = Number(value(env, 'WOA_AI_MAX_REQUESTS_PER_MONTH'));

  add('WOA_DATA_BACKEND', value(env, 'WOA_DATA_BACKEND') === 'postgres', 'Use the transactional PostgreSQL backend.');
  add('DATABASE_URL', validPostgresUrl(value(env, 'DATABASE_URL')), 'Use a complete PostgreSQL connection URL for the production database.');
  add('DATABASE_NETWORK_SCOPE', validPrivatePostgresUrl(value(env, 'DATABASE_URL')), 'Use the provider private/internal database URL instead of an Internet-routable hostname.');
  add('WOA_TEST_DATABASE_URL', !value(env, 'WOA_TEST_DATABASE_URL'), 'Keep dedicated drill credentials out of the long-running web service.');
  add('WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL', !value(env, 'WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL'), 'Inject recovery-proof credentials only into the short-lived drill command.');
  add('WOA_MIGRATION_MAINTENANCE_MODE', !enabled(env, 'WOA_MIGRATION_MAINTENANCE_MODE'), 'Disable maintenance mode in the final launch environment after import verification.');
  add('WOA_POSTGRES_SNAPSHOT_LIMIT', !value(env, 'WOA_POSTGRES_SNAPSHOT_LIMIT') || (Number.isInteger(Number(value(env, 'WOA_POSTGRES_SNAPSHOT_LIMIT'))) && Number(value(env, 'WOA_POSTGRES_SNAPSHOT_LIMIT')) >= 30), 'Retain at least 30 transactional recovery snapshots.');

  add('WOA_DOCUMENT_STORAGE_PROVIDER', value(env, 'WOA_DOCUMENT_STORAGE_PROVIDER') === 's3', 'Production private files require S3-compatible storage.');
  add('WOA_DOCUMENT_ENCRYPTION_KEY', !!documentKey, 'The active document encryption key must decode to exactly 32 bytes.');
  add('WOA_DOCUMENT_ENCRYPTION_KEY_VERSION', /^[a-zA-Z0-9._-]{1,80}$/.test(value(env, 'WOA_DOCUMENT_ENCRYPTION_KEY_VERSION')), 'Name the active encryption-key version explicitly.');
  add('WOA_OBJECT_STORAGE_BUCKET', !!value(env, 'WOA_OBJECT_STORAGE_BUCKET', 'S3_BUCKET'), 'Configure the private object-storage bucket.');
  add('WOA_OBJECT_STORAGE_ENDPOINT', validPrivateObjectStorageEndpoint(value(env, 'WOA_OBJECT_STORAGE_ENDPOINT', 'S3_ENDPOINT')), 'Use the private HTTPS S3 API endpoint, never a public r2.dev delivery URL.');
  add('WOA_OBJECT_STORAGE_ACCESS_KEY_ID', !!value(env, 'WOA_OBJECT_STORAGE_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID'), 'Configure the private bucket access-key ID.');
  add('WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY', !!value(env, 'WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY', 'S3_SECRET_ACCESS_KEY'), 'Configure the private bucket secret access key.');
  add('WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED', enabled(env, 'WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED'), 'Fail closed when encrypted private storage is unavailable.');
  add('WOA_STATE_BACKUP_ENABLED', enabled(env, 'WOA_STATE_BACKUP_ENABLED'), 'Enable scheduled encrypted offsite state backups.');
  add('WOA_STATE_BACKUP_ENCRYPTION_KEY', !!backupKey, 'Use a dedicated 32-byte state-backup encryption key.');
  add('WOA_STATE_BACKUP_KEY_ISOLATION', !!(documentKey && backupKey && !documentKey.equals(backupKey)), 'The state-backup key must differ from the private-document key.');
  add('WOA_STATE_BACKUP_KEY_VERSION', /^[a-zA-Z0-9._-]{1,80}$/.test(value(env, 'WOA_STATE_BACKUP_KEY_VERSION')), 'Name the state-backup key version explicitly.');

  add('STRIPE_SECRET_KEY', /^sk_live_[A-Za-z0-9_]+$/.test(stripeSecret), 'Use the activated Stripe live secret key, never a test key.');
  add('STRIPE_PUBLISHABLE_KEY', /^pk_live_[A-Za-z0-9_]+$/.test(stripePublishable), 'Use the matching Stripe live publishable key.');
  add('STRIPE_WEBHOOK_SECRET', /^whsec_[A-Za-z0-9_]+$/.test(stripeWebhook), 'Configure the signed live Stripe webhook secret.');
  add('WOA_PAYMENT_PROVIDER', value(env, 'WOA_PAYMENT_PROVIDER') === 'clover', 'Keep Clover as the default during controlled customer-by-customer Stripe cutover.');
  add('WOA_ONBOARDING_PAYMENT_PROVIDER', value(env, 'WOA_ONBOARDING_PAYMENT_PROVIDER') === 'stripe', 'Route new onboarding through Stripe.');
  add('WOA_IDENTITY_PROVIDER', value(env, 'WOA_IDENTITY_PROVIDER') === 'stripe', 'Use Stripe Identity for hosted license and selfie verification.');

  add('WOA_MESSAGING_PROVIDER', value(env, 'WOA_MESSAGING_PROVIDER', 'MESSAGING_PROVIDER') === 'telnyx', 'Use the approved Telnyx messaging profile.');
  add('TELNYX_API_KEY', !!value(env, 'TELNYX_API_KEY'), 'Configure the Telnyx API key.');
  add('TELNYX_PUBLIC_KEY', !!value(env, 'TELNYX_PUBLIC_KEY'), 'Configure the Telnyx webhook-signing public key.');
  add('TELNYX_MESSAGING_PROFILE_ID', !!value(env, 'TELNYX_MESSAGING_PROFILE_ID'), 'Configure the approved Telnyx messaging profile.');
  add('WOA_MESSAGING_FROM_NUMBER', /^\+1\d{10}$/.test(value(env, 'WOA_MESSAGING_FROM_NUMBER', 'MESSAGING_FROM_NUMBER')), 'Use the assigned E.164 Telnyx number.');
  add('TELNYX_10DLC_USECASE', value(env, 'TELNYX_10DLC_USECASE') === 'CUSTOMER_CARE', 'Keep the registered CUSTOMER_CARE use case aligned with the campaign.');

  add('WOA_EMAIL_PROVIDER', value(env, 'WOA_EMAIL_PROVIDER', 'EMAIL_PROVIDER') === 'resend', 'Use Resend for production email.');
  add('RESEND_API_KEY', !!value(env, 'RESEND_API_KEY', 'WOA_RESEND_API_KEY'), 'Configure the Resend API key.');
  add('RESEND_WEBHOOK_SECRET', !!value(env, 'RESEND_WEBHOOK_SECRET', 'WOA_RESEND_WEBHOOK_SECRET'), 'Configure signed inbound Resend webhooks.');
  add('WOA_EMAIL_FROM', validEmailSender(value(env, 'WOA_EMAIL_FROM', 'EMAIL_FROM')), 'Send from wheelsonauto.com or a verified subdomain.');

  add('OPENAI_API_KEY', !!value(env, 'OPENAI_API_KEY', 'WOA_OPENAI_API_KEY'), 'Configure the restricted OpenAI project key for Star.');
  add('WOA_AI_MODEL', !!value(env, 'WOA_AI_MODEL', 'OPENAI_MODEL'), 'Pin the Star model explicitly.');
  add('WOA_AI_MAX_REQUESTS_PER_DAY', Number.isInteger(dailyAiLimit) && dailyAiLimit > 0, 'Set an explicit daily Star request limit.');
  add('WOA_AI_MAX_REQUESTS_PER_MONTH', Number.isInteger(monthlyAiLimit) && monthlyAiLimit >= dailyAiLimit, 'Set an explicit monthly Star request limit at least as large as the daily limit.');

  add('WOA_SESSION_SECRET', value(env, 'WOA_SESSION_SECRET', 'WOA_COOKIE_SECRET').length >= 32, 'Use a stable session secret of at least 32 characters.');
  add('PUBLIC_BASE_URL', validHttps(value(env, 'PUBLIC_BASE_URL')), 'Use the final HTTPS WheelsonAuto public origin.');
  add('WOA_ERROR_ALERTS_ENABLED', enabled(env, 'WOA_ERROR_ALERTS_ENABLED'), 'Enable failed-job, webhook, and autopay alerts.');
  add('WOA_PRODUCTION_HARDENING_REQUIRED', enabled(env, 'WOA_PRODUCTION_HARDENING_REQUIRED'), 'Require all live runtime evidence before the service starts.');

  const missing = checks.filter(check => !check.ready);
  return {
    ready: missing.length === 0,
    checkedAt: new Date().toISOString(),
    phase: 'controlled-clover-to-stripe-launch',
    checks,
    missing: missing.map(check => check.key),
    message: missing.length
      ? 'Production environment is incomplete. Review the named keys without exposing their values.'
      : 'Production environment names and value shapes are ready for runtime provider and recovery proof.'
  };
}

module.exports = {
  productionEnvironmentReport,
  validHttps,
  validPrivateObjectStorageEndpoint,
  validPostgresUrl,
  validPrivatePostgresUrl,
  validEmailSender
};
