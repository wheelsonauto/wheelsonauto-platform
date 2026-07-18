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
    'WOA_ONBOARDING_PAYMENT_PROVIDER',
    "'/api/webhooks/stripe'",
    "'/api/payment-provider/switch'",
    'cloverStoppedConfirmed',
    'stripePaymentMethodId',
    'chargeStripeSavedCard',
    'stripeDisputeEvidencePacket',
    'createRefund',
    "'/api/integrations/payments/refunds/execute'",
    'refund\\.(created|updated|failed)',
    'woa_refund_request_id',
    'applyRefundPaymentCompletion',
    'identity.verification_session.verified',
    'STRIPE_IDENTITY_RUNTIME_READY',
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
  assert(server.includes('await assertStripeCutoverLaunchReady(data);'), 'The live provider-switch route must enforce the complete production launch gate before scheduling Stripe.');
  ['claim_token', 'idempotencyClaimToken', 'claimIdempotencyKey', 'completeIdempotencyKey', 'failIdempotencyKey'].forEach(value => {
    assert(stateRepository.includes(value), 'Missing durable Stripe idempotency repository marker: ' + value);
  });
  assert(app.includes('id="rPaymentProvider"'), 'Admin recurring setup must expose a Clover/Stripe provider choice.');
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
