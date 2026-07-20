const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const stripeAdapter = require('../stripe-adapter');
const stripeMigration = require('../stripe-migration');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const nativeSite = fs.readFileSync(path.join(root, 'native-site.js'), 'utf8');
const stateRepository = fs.readFileSync(path.join(root, 'state-repository.js'), 'utf8');

async function run() {
  const liveStripeFoundation = {
    configured: true,
    keyMode: 'live',
    webhookSecretConfigured: true,
    transactionalStateReady: true,
    privateDocumentStorageReady: true,
    stateBackupConfigured: true
  };
  const form = stripeAdapter.formBody({
    mode: 'setup',
    payment_method_types: ['card'],
    metadata: { recurringPaymentId: 'rec-1', customerName: 'Test Customer' }
  }).toString();
  assert(form.includes('payment_method_types%5B0%5D=card'), 'Stripe arrays must use indexed form keys.');
  assert(form.includes('metadata%5BrecurringPaymentId%5D=rec-1'), 'Stripe metadata must be encoded as nested form keys.');

  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' });
  const timestamp = 1784250000;
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  assert.strictEqual(stripeAdapter.verifyWebhook(body, 't=' + timestamp + ',v1=' + signature, secret, 300, timestamp).ok, true, 'Valid Stripe webhook signatures must pass.');
  assert.strictEqual(stripeAdapter.verifyWebhook(body, 't=' + timestamp + ',v1=' + '0'.repeat(64), secret, 300, timestamp).ok, false, 'Invalid Stripe webhook signatures must fail.');
  assert.strictEqual(stripeAdapter.verifyWebhook(body, 't=' + timestamp + ',v1=' + signature, secret, 300, timestamp + 301).ok, false, 'Expired Stripe webhook signatures must fail.');

  assert.strictEqual(stripeMigration.isolatedProviderTestMode({ NODE_ENV: 'test', WOA_ALLOW_ISOLATED_PROVIDER_TESTS: '1' }), true, 'Explicit isolated tests may exercise the cutover state machine without live providers.');
  assert.strictEqual(stripeMigration.isolatedProviderTestMode({ NODE_ENV: 'test', WOA_ALLOW_ISOLATED_PROVIDER_TESTS: '1', RENDER: 'true' }), false, 'A Render deployment must never enable the isolated provider-test path.');
  assert.strictEqual(stripeMigration.isolatedProviderTestMode({ NODE_ENV: 'production', WOA_ALLOW_ISOLATED_PROVIDER_TESTS: '1' }), false, 'Production must never enable the isolated provider-test path.');
  assert.strictEqual(stripeMigration.stripeCardPreparationReady({ configured: true, keyMode: 'test', webhookSecretConfigured: true }), false, 'A Stripe test key must never expose customer card setup on a deployed site.');
  assert.strictEqual(stripeMigration.stripeCardPreparationReady({ configured: true, keyMode: 'live', webhookSecretConfigured: true }), false, 'Live Stripe keys alone must never store card-setup state on the JSON backend.');
  assert.strictEqual(stripeMigration.stripeCardPreparationReady(liveStripeFoundation), true, 'Live Stripe card setup requires transactional state, encrypted private storage, and dedicated offsite backups.');
  assert.strictEqual(stripeMigration.stripeIdentityPreparationReady({ configured: true, keyMode: 'live', webhookSecretConfigured: true }), false, 'Live Stripe keys alone must never start an identity session whose state and documents remain on JSON.');
  assert.strictEqual(stripeMigration.stripeIdentityPreparationReady(liveStripeFoundation), true, 'Live Stripe Identity requires transactional state, encrypted private storage, and dedicated offsite backups.');
  assert.throws(
    () => stripeMigration.assertStripeCardPreparationReady({ configured: true, keyMode: 'test', webhookSecretConfigured: true }),
    error => error && error.code === 'stripe_card_preparation_not_live' && error.statusCode === 503,
    'Customer card preparation must fail closed outside live mode.'
  );
  assert.throws(
    () => stripeMigration.assertStripeCardPreparationReady({ ...liveStripeFoundation, transactionalStateReady: false }),
    error => error && error.code === 'stripe_card_preparation_not_live' && error.missing.includes('transactional PostgreSQL state backend'),
    'Live Stripe card preparation must name the missing transactional backend instead of writing migration state to JSON.'
  );
  assert.throws(
    () => stripeMigration.assertStripeCardPreparationReady({ ...liveStripeFoundation, privateDocumentStorageReady: false, stateBackupConfigured: false }),
    error => error && error.missing.includes('production-ready encrypted private object storage') && error.missing.includes('dedicated encrypted offsite state-backup configuration'),
    'Live Stripe card preparation must fail closed until private storage and offsite backups are configured.'
  );
  assert.throws(
    () => stripeMigration.assertStripeIdentityPreparationReady({ ...liveStripeFoundation, transactionalStateReady: false, privateDocumentStorageReady: false }),
    error => error && error.code === 'stripe_identity_preparation_not_live' && error.missing.includes('transactional PostgreSQL state backend') && error.missing.includes('production-ready encrypted private object storage'),
    'Live Stripe Identity must fail closed before creating or retrieving a provider session when production state or private storage is unsafe.'
  );
  assert.strictEqual(stripeMigration.stripeMoneyActionsArmed({ ...liveStripeFoundation, productionHardeningRequired: false }), false, 'A live key and infrastructure alone must not arm Stripe money actions.');
  assert.strictEqual(stripeMigration.stripeMoneyActionsArmed({ ...liveStripeFoundation, keyMode: 'test', productionHardeningRequired: true }), false, 'Production hardening must never arm a Stripe test key.');
  assert.strictEqual(stripeMigration.stripeMoneyActionsArmed({ ...liveStripeFoundation, productionHardeningRequired: true }), true, 'Live Stripe money actions require hardening, live Stripe, PostgreSQL, private storage, and dedicated offsite backups.');
  assert.strictEqual(stripeMigration.stripeMoneyActionsArmed({ isolatedTestMode: true }), true, 'Explicit isolated tests may exercise Stripe money workflows without a live account.');
  assert.throws(
    () => stripeMigration.assertStripeMoneyActionsArmed({ ...liveStripeFoundation, productionHardeningRequired: false }),
    error => error && error.code === 'stripe_money_actions_not_armed' && error.statusCode === 409,
    'Stripe charges and refunds must fail closed until production hardening is armed.'
  );
  assert.strictEqual(stripeMigration.stripeLiveResultAccepted({ keyMode: 'live', livemode: true }), true, 'Signed live Stripe results may update customer records.');
  assert.strictEqual(stripeMigration.stripeLiveResultAccepted({ keyMode: 'live', livemode: false }), false, 'Stripe test events must not update real customer records.');
  assert.strictEqual(stripeMigration.stripeLiveResultAccepted({ isolatedTestMode: true, keyMode: 'test', livemode: false }), true, 'Isolated local/CI tests may process Stripe test events.');
  assert.throws(
    () => stripeMigration.assertStripeCutoverLaunchReady({ productionHardeningRequired: false }),
    error => error && error.code === 'stripe_cutover_launch_not_armed' && error.statusCode === 409,
    'Clover-to-Stripe cutover must stay locked while production hardening is off.'
  );
  assert.throws(
    () => stripeMigration.assertStripeCutoverLaunchReady({ productionHardeningRequired: true, preflight: { readyForLiveStripe: false, missing: ['private object storage'] } }),
    error => error && error.code === 'stripe_cutover_preflight_blocked' && error.missing.includes('private object storage'),
    'Clover-to-Stripe cutover must preserve the exact failed launch gates for owner review.'
  );
  assert.deepStrictEqual(
    stripeMigration.assertStripeCutoverLaunchReady({ productionHardeningRequired: true, preflight: { readyForLiveStripe: true, missing: [] } }),
    { ready: true, isolatedTestMode: false },
    'A fully hardened, green live preflight must arm controlled cutover.'
  );

  let captured = null;
  const client = stripeAdapter.stripeClient({
    secretKey: 'sk_test_private',
    fetch: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'pi_test', status: 'succeeded' }) };
    }
  });
  await client.retrieveAccount();
  assert(captured.url.endsWith('/account'), 'Stripe account readiness must use the authenticated account endpoint.');
  assert.strictEqual(captured.options.method, 'GET', 'Stripe account readiness must be a read-only request.');
  assert.strictEqual(captured.options.body, undefined, 'Stripe account readiness must never submit money or account changes.');
  await client.createCustomer({ name: 'Test Customer', metadata: { recurringPaymentId: 'rec-1' } }, 'woa-customer-test-key');
  assert(captured.url.endsWith('/customers'), 'Stripe customer creation must use the provider customer endpoint.');
  assert.strictEqual(captured.options.headers['Idempotency-Key'], 'woa-customer-test-key', 'Stripe customer creation must use a deterministic idempotency key so a restart cannot create a duplicate customer.');
  await client.createPaymentIntent({ amount: 22900, currency: 'usd', metadata: { recurringPaymentId: 'rec-1' } }, 'woa-test-key');
  assert.strictEqual(captured.options.headers.Authorization, 'Bearer sk_test_private', 'Stripe secret key must only be sent in the Authorization header.');
  assert.strictEqual(captured.options.headers['Idempotency-Key'], 'woa-test-key', 'Money actions must use an idempotency key.');
  assert(captured.options.body.includes('amount=22900'), 'Stripe charge amount must be encoded in cents.');
  await client.createRefund({ payment_intent: 'pi_test', amount: 1200, metadata: { woa_refund_request_id: 'refund-1' } }, 'woa-refund-key');
  assert(captured.url.endsWith('/refunds'), 'Stripe refunds must use the provider refund endpoint.');
  assert.strictEqual(captured.options.headers['Idempotency-Key'], 'woa-refund-key', 'Stripe refunds must use an idempotency key.');
  assert(new URLSearchParams(captured.options.body).get('payment_intent') === 'pi_test' && new URLSearchParams(captured.options.body).get('amount') === '1200', 'Stripe refund payment source and amount must be encoded correctly.');
  await client.createIdentityVerificationSession({ type: 'document', options: { document: { allowed_types: ['driving_license'], require_live_capture: true, require_matching_selfie: true } } }, 'woa-identity-test');
  assert(captured.url.endsWith('/identity/verification_sessions'), 'Stripe Identity sessions must use the provider-hosted verification endpoint.');
  assert(new URLSearchParams(captured.options.body).get('options[document][require_matching_selfie]') === 'true', 'Stripe Identity sessions must require a matching selfie.');
  await client.retrieveDispute('dp_test');
  assert(captured.url.endsWith('/disputes/dp_test') && captured.options.method === 'GET', 'Stripe dispute reconciliation must retrieve the exact provider case without changing it.');
  await client.submitDisputeEvidence('dp_test', { evidence: { customer_name: 'Test Customer', product_description: 'Test rental service' }, submit: true }, 'woa-dispute-key');
  const disputeForm = new URLSearchParams(captured.options.body);
  assert(captured.url.endsWith('/disputes/dp_test') && captured.options.method === 'POST', 'Stripe evidence submission must update the exact provider dispute.');
  assert(captured.options.headers['Idempotency-Key'] === 'woa-dispute-key' && disputeForm.get('submit') === 'true' && disputeForm.get('evidence[customer_name]') === 'Test Customer', 'Stripe evidence submission must preserve nested evidence, explicit submit, and idempotency.');

  const uncertainClient = stripeAdapter.stripeClient({
    secretKey: 'sk_test_private',
    fetch: async () => {
      const error = new Error('The network connection was lost.');
      error.name = 'AbortError';
      throw error;
    }
  });
  await assert.rejects(
    () => uncertainClient.createPaymentIntent({ amount: 22900, currency: 'usd' }, 'woa-timeout-key'),
    error => error && error.code === 'stripe_confirmation_pending' && error.ambiguous === true && error.timedOut === true && error.idempotencyKey === 'woa-timeout-key',
    'A timeout after an idempotent money request must be classified as confirmation pending, never as a clean decline.'
  );
  await assert.rejects(
    () => uncertainClient.createCustomer({ name: 'Restart Test' }, 'woa-customer-timeout-key'),
    error => error && error.code === 'stripe_confirmation_pending' && error.ambiguous === true && error.idempotencyKey === 'woa-customer-timeout-key',
    'A customer-creation timeout must retain the deterministic Stripe idempotency key for a safe restart retry.'
  );
  const serverErrorClient = stripeAdapter.stripeClient({
    secretKey: 'sk_test_private',
    fetch: async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'Temporary Stripe error' } }) })
  });
  await assert.rejects(
    () => serverErrorClient.createPaymentIntent({ amount: 22900, currency: 'usd' }, 'woa-500-key'),
    error => error && error.ambiguous === true && error.retryable === true && error.idempotencyKey === 'woa-500-key',
    'Stripe 5xx responses must remain tied to the original idempotency key for safe reconciliation.'
  );

  [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    "'/api/integrations/stripe/readiness'",
    'stripeAccountLiveEvidence',
    'lastAccountChargesEnabled',
    'lastAccountPayoutsEnabled',
    'WOA_ONBOARDING_PAYMENT_PROVIDER',
    "'/api/webhooks/stripe'",
    "'/api/payment-provider/switch'",
    'cloverStoppedConfirmed',
    'cloverSubscriptionConfirmation',
    'clover_subscription_confirmation_mismatch',
    'stripePaymentMethodId',
    'chargeStripeSavedCard',
    'stripeDisputeEvidencePacket',
    'stripeDisputeSubmissionPayload',
    'executeStripeDisputeEvidenceSubmission',
    'submitDisputeEvidence',
    'retrieveDispute',
    'stripe_dispute_confirmation_pending',
    'createRefund',
    "'/api/integrations/payments/refunds/execute'",
    'refund\\.(created|updated|failed)',
    'woa_refund_request_id',
    'applyRefundPaymentCompletion',
    'identity.verification_session.verified',
    'STRIPE_IDENTITY_RUNTIME_READY',
    'assertStripeCardPreparationReady',
    'assertStripeIdentityPreparationReady',
    'assertStripeMoneyActionsArmed',
    "transactionalStateReady: STATE_REPOSITORY.kind === 'postgres'",
    'privateDocumentStorageReady: WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED',
    'stateBackupConfigured: WOA_STATE_BACKUP_ENABLED',
    'stripeLiveResultAccepted',
    'stripeLivemode',
    'Owner must review reason-specific evidence',
    'Stripe card ready - Clover remains active until owner confirmation',
    'recurringCardReadyForProvider',
    'paymentProviderLabel(paymentProvider)',
    'stripe_authentication_required',
    'stripeCardAuthenticationSetupNeeded',
    'payment_intent.requires_action',
    'stripeAutopayChargeSequence',
    'saveStripeAuthenticationRequiredResult',
    'claimIdempotencyKey',
    'stripe_recurring_charge',
    'stripeRecurringChargeClaimKey',
    'idempotencyClaimToken',
    'completeStripeRecurringChargeClaim',
    'failStripeRecurringChargeClaim'
  ].forEach(value => assert(server.includes(value), 'Missing Stripe safety/runtime marker: ' + value));
  assert(server.includes("stableId('woa-stripe-customer'") && server.includes('stripeCustomerIdempotencyKey'), 'Stripe customer creation must derive and retain a deterministic company-and-customer-scoped idempotency key.');
  assert(server.includes('await assertStripeCutoverLaunchReady(data);'), 'The live provider-switch route must enforce the complete production launch gate before scheduling Stripe.');
  ['claim_token', 'idempotencyClaimToken', 'claimIdempotencyKey', 'completeIdempotencyKey', 'failIdempotencyKey'].forEach(value => {
    assert(stateRepository.includes(value), 'Missing durable Stripe idempotency repository marker: ' + value);
  });
  assert(app.includes('id="rPaymentProvider"'), 'Admin recurring setup must expose a Clover/Stripe provider choice.');
  assert(app.includes('stripeCutoverPlanIdentity') && app.includes('providerCloverSubscriptionConfirmation') && app.includes('Exact recurring plan'), 'Admin Stripe cutover must show and require the exact Clover plan identity.');
  assert(app.includes("r.stripeCustomerId&&r.stripePaymentMethodId"), 'Admin charge readiness must recognize only complete Stripe saved-card records.');
  assert(app.includes('stripe card update required'), 'Admin payment status must clearly show when Stripe requires a customer card update.');
  assert(nativeSite.includes("recurring.stripeCustomerId && recurring.stripePaymentMethodId"), 'Public Stripe onboarding must require both Stripe customer and reusable payment-method references.');
  assert(nativeSite.includes('identity_selfie'), 'Public Stripe onboarding must include the required identity selfie step.');
  assert(nativeSite.includes('data-onboarding-form="identity"'), 'Public onboarding must expose Stripe Identity inside the existing verification step.');
  assert(!server.includes('STRIPE_SECRET_KEY || \'sk_'), 'No Stripe secret fallback may be committed.');

  console.log('Stripe payment adapter, migration, webhook, and dispute checks passed.');
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
