'use strict';

const { refreshStripeLaunchReadiness, closeStateRepositoryForAudit } = require('../server');

async function main() {
  const result = await refreshStripeLaunchReadiness({
    name: 'WheelsonAuto production audit',
    role: 'Owner'
  });
  const account = result.body.stripeAccount || {};
  const destination = result.body.stripeWebhookDestination || {};
  console.log(JSON.stringify({
    ok: result.body.ok === true,
    account: {
      live: account.live === true,
      chargesEnabled: account.chargesEnabled === true,
      payoutsEnabled: account.payoutsEnabled === true,
      cardPaymentsCapability: String(account.cardPaymentsCapability || ''),
      accountRequirementsClear: account.accountRequirementsClear === true,
      error: String(account.error || '')
    },
    webhookDestination: {
      live: destination.live === true,
      endpointMatched: destination.endpointMatched === true,
      active: destination.active === true,
      enabledEventCount: Number(destination.enabledEventCount || 0),
      requiredEventCount: Number(destination.requiredEventCount || 0),
      missingEvents: Array.isArray(destination.missingEvents) ? destination.missingEvents : [],
      unexpectedEvents: Array.isArray(destination.unexpectedEvents) ? destination.unexpectedEvents : [],
      error: String(destination.error || '')
    }
  }, null, 2));
  if (result.body.ok !== true || account.live !== true || destination.live !== true) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(String(error && error.message || error));
    process.exitCode = 1;
  })
  .finally(() => closeStateRepositoryForAudit().catch(() => {}));
