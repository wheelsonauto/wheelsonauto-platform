'use strict';

const CONFIRMATION_PHRASE = 'VERIFY LIVE STRIPE ACCOUNT AND WEBHOOK DESTINATION';

function assertProductionEnvironment(environment = process.env) {
  if (String(environment.WOA_STRIPE_READINESS_PROOF_CONFIRM || '').trim() !== CONFIRMATION_PHRASE) {
    throw new Error('Set WOA_STRIPE_READINESS_PROOF_CONFIRM="' + CONFIRMATION_PHRASE + '" for this one controlled run.');
  }
  if (String(environment.WOA_DATA_BACKEND || '').trim().toLowerCase() !== 'postgres') {
    throw new Error('Stripe readiness proof can only be recorded while WOA_DATA_BACKEND=postgres.');
  }
  if (String(environment.WOA_STRIPE_KEY_MODE || '').trim().toLowerCase() !== 'live') {
    throw new Error('Stripe readiness proof requires WOA_STRIPE_KEY_MODE=live.');
  }
  if (!String(environment.STRIPE_SECRET_KEY || '').trim().startsWith('sk_live_')) {
    throw new Error('Stripe readiness proof requires the deployed live Stripe secret key.');
  }
  if (!String(environment.STRIPE_WEBHOOK_SECRET || '').trim().startsWith('whsec_')) {
    throw new Error('Stripe readiness proof requires the deployed Stripe webhook signing secret.');
  }
  const publicBaseUrl = String(environment.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (publicBaseUrl !== 'https://wheelsonauto-platform.onrender.com') {
    throw new Error('PUBLIC_BASE_URL must be the exact WheelsonAuto production origin before recording Stripe readiness proof.');
  }
}

function sanitizedResult(result = {}) {
  const body = result && result.body || {};
  const account = body.stripeAccount || {};
  const destination = body.stripeWebhookDestination || {};
  return {
    ok: body.ok === true,
    account: {
      live: account.live === true,
      keyMode: String(account.keyMode || ''),
      chargesEnabled: account.chargesEnabled === true,
      payoutsEnabled: account.payoutsEnabled === true,
      detailsSubmitted: account.detailsSubmitted === true,
      cardPaymentsCapability: String(account.cardPaymentsCapability || ''),
      accountRequirementsClear: account.accountRequirementsClear === true,
      checkedAt: String(account.checkedAt || ''),
      error: String(account.error || '')
    },
    webhookDestination: {
      live: destination.live === true,
      endpointMatched: destination.endpointMatched === true,
      active: destination.active === true,
      exactEvents: destination.exactEvents === true,
      enabledEventCount: Number(destination.enabledEventCount || 0),
      requiredEventCount: Number(destination.requiredEventCount || 0),
      missingEvents: Array.isArray(destination.missingEvents) ? destination.missingEvents : [],
      unexpectedEvents: Array.isArray(destination.unexpectedEvents) ? destination.unexpectedEvents : [],
      checkedAt: String(destination.checkedAt || ''),
      error: String(destination.error || '')
    }
  };
}

async function main(environment = process.env, dependencies = {}) {
  assertProductionEnvironment(environment);
  const server = dependencies.server || require('../server');
  try {
    const result = await server.refreshStripeLaunchReadiness({
      name: 'WheelsonAuto controlled production readiness command',
      role: 'Owner'
    });
    const summary = sanitizedResult(result);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok || !summary.account.live || !summary.webhookDestination.live) {
      throw new Error('Stripe readiness proof was recorded, but the live account or exact webhook destination is not launch-ready.');
    }
    console.log('Live Stripe account and exact signed webhook destination proof were verified and recorded in PostgreSQL.');
    return summary;
  } finally {
    if (server && typeof server.closeStateRepositoryForAudit === 'function') {
      await server.closeStateRepositoryForAudit();
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exit(1);
  });
}

module.exports = {
  CONFIRMATION_PHRASE,
  assertProductionEnvironment,
  main,
  sanitizedResult
};
