'use strict';

const assert = require('node:assert/strict');
const {
  CONFIRMATION_PHRASE,
  assertProductionEnvironment,
  main,
  sanitizedResult
} = require('./refresh-stripe-launch-proof');

const validEnvironment = {
  WOA_STRIPE_READINESS_PROOF_CONFIRM: CONFIRMATION_PHRASE,
  WOA_DATA_BACKEND: 'postgres',
  WOA_STRIPE_KEY_MODE: 'live',
  STRIPE_SECRET_KEY: 'sk_live_redacted_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_redacted_test_fixture',
  PUBLIC_BASE_URL: 'https://wheelsonauto-platform.onrender.com/'
};

function readyResult(overrides = {}) {
  return {
    body: {
      ok: true,
      stripeAccount: {
        live: true,
        keyMode: 'live',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        cardPaymentsCapability: 'active',
        accountRequirementsClear: true,
        checkedAt: '2026-07-27T05:00:00.000Z'
      },
      stripeWebhookDestination: {
        live: true,
        endpointMatched: true,
        active: true,
        exactEvents: true,
        enabledEventCount: 16,
        requiredEventCount: 16,
        checkedAt: '2026-07-27T05:00:00.000Z'
      },
      ...overrides
    }
  };
}

async function run() {
  assert.doesNotThrow(() => assertProductionEnvironment(validEnvironment));
  for (const [key, value] of [
    ['WOA_STRIPE_READINESS_PROOF_CONFIRM', ''],
    ['WOA_DATA_BACKEND', 'json'],
    ['WOA_STRIPE_KEY_MODE', 'test'],
    ['STRIPE_SECRET_KEY', 'sk_test_fixture'],
    ['STRIPE_WEBHOOK_SECRET', ''],
    ['PUBLIC_BASE_URL', 'https://example.com']
  ]) {
    assert.throws(() => assertProductionEnvironment({ ...validEnvironment, [key]: value }));
  }

  const redacted = sanitizedResult(readyResult({ secret: 'must-not-escape' }));
  assert.equal(redacted.account.live, true);
  assert.equal(redacted.webhookDestination.exactEvents, true);
  assert.equal(JSON.stringify(redacted).includes('must-not-escape'), false);

  let refreshCalls = 0;
  let closeCalls = 0;
  const server = {
    async refreshStripeLaunchReadiness(user) {
      refreshCalls += 1;
      assert.equal(user.role, 'Owner');
      return readyResult();
    },
    async closeStateRepositoryForAudit() {
      closeCalls += 1;
    }
  };
  const summary = await main(validEnvironment, { server });
  assert.equal(summary.account.live, true);
  assert.equal(refreshCalls, 1);
  assert.equal(closeCalls, 1);

  closeCalls = 0;
  await assert.rejects(
    () => main(validEnvironment, {
      server: {
        async refreshStripeLaunchReadiness() {
          return readyResult({ stripeWebhookDestination: { live: false, error: 'Not ready' } });
        },
        async closeStateRepositoryForAudit() {
          closeCalls += 1;
        }
      }
    }),
    /not launch-ready/
  );
  assert.equal(closeCalls, 1);
  console.log('Stripe launch proof command checks passed.');
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
