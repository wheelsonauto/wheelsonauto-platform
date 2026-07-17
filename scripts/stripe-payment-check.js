const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const stripeAdapter = require('../stripe-adapter');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

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

  [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    "'/api/webhooks/stripe'",
    "'/api/payment-provider/switch'",
    'cloverStoppedConfirmed',
    'stripePaymentMethodId',
    'chargeStripeSavedCard',
    'stripeDisputeEvidencePacket',
    'Owner must review reason-specific evidence',
    'Stripe card ready - Clover remains active until owner confirmation'
  ].forEach(value => assert(server.includes(value), 'Missing Stripe safety/runtime marker: ' + value));
  assert(app.includes('id="rPaymentProvider"'), 'Admin recurring setup must expose a Clover/Stripe provider choice.');
  assert(app.includes("r.stripeCustomerId&&r.stripePaymentMethodId"), 'Admin charge readiness must recognize only complete Stripe saved-card records.');
  assert(!server.includes('STRIPE_SECRET_KEY || \'sk_'), 'No Stripe secret fallback may be committed.');

  console.log('Stripe payment adapter, migration, webhook, and dispute checks passed.');
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
