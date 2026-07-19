'use strict';

const assert = require('node:assert');

process.env.WOA_SESSION_SECRET = 'provider-launch-proof-session-secret';
process.env.WOA_MESSAGING_ENABLED = '1';
process.env.WOA_STAR_AI_ENABLED = '1';
process.env.WOA_AI_AUTO_SEND = '0';
process.env.WOA_AI_REPLY_DRAFTS = '1';
process.env.WOA_EMAIL_ENABLED = '1';
process.env.WOA_MESSAGING_PROVIDER = 'telnyx';
process.env.WOA_MESSAGING_FROM_NUMBER = '+16095550199';
process.env.WOA_MESSAGING_WEBHOOK_SECRET = 'provider-launch-proof-webhook-secret';
process.env.TELNYX_API_KEY = 'KEY-provider-launch-proof';
process.env.TELNYX_PUBLIC_KEY = 'provider-launch-proof-public-key';
process.env.TELNYX_MESSAGING_PROFILE_ID = 'profile-provider-launch-proof';
process.env.WOA_EMAIL_PROVIDER = 'resend';
process.env.WOA_EMAIL_FROM = 'WheelsonAuto <notifications@notify.wheelsonauto.com>';
process.env.RESEND_API_KEY = 're_provider_launch_proof';
process.env.RESEND_WEBHOOK_SECRET = 'whsec_provider_launch_proof';
process.env.OPENAI_API_KEY = 'test-openai-provider-launch-proof';
process.env.WOA_AI_MODEL = 'gpt-5.4-nano';
process.env.WOA_AI_MAX_REQUESTS_PER_DAY = '50';
process.env.WOA_AI_MAX_REQUESTS_PER_MONTH = '500';
process.env.STRIPE_SECRET_KEY = 'sk_live_provider_launch_proof';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_provider_launch_proof';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_provider_launch_proof';
process.env.WOA_ONBOARDING_PAYMENT_PROVIDER = 'stripe';
process.env.WOA_IDENTITY_PROVIDER = 'stripe';
process.env.WOA_STRIPE_ACCOUNT_VALIDATION_MAX_AGE_MS = String(24 * 60 * 60 * 1000);
process.env.WOA_STRIPE_WEBHOOK_VALIDATION_MAX_AGE_MS = String(30 * 24 * 60 * 60 * 1000);

const {
  messagingLaunchConfigurationFingerprint,
  emailLaunchConfigurationFingerprint,
  usesVerifiedWheelsonAutoSendingDomain,
  starAiLaunchConfigurationFingerprint,
  telnyxLiveLaunchEvidence,
  resendLiveLaunchEvidence,
  starAiLiveLaunchEvidence,
  stripeAccountConfigurationFingerprint,
  stripeAccountLiveEvidence,
  stripeWebhookConfigurationFingerprint,
  stripeLiveWebhookEvidence,
  stripeIdentityLiveWebhookEvidence,
  stateForUserRead,
  stateForUserWrite
} = require('../server');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readyState() {
  const now = new Date().toISOString();
  const data = {
    messages: [
      {
        id: 'telnyx-delivery-proof',
        externalId: 'telnyx-delivery-proof',
        provider: 'telnyx',
        providerStatus: 'delivered',
        deliveryUpdatedAt: now,
        createdAt: now,
        status: 'Delivered'
      }
    ],
    integrations: {
      messaging: {
        enabled: true,
        aiEnabled: true,
        aiAutoSend: false,
        aiDrafts: true,
        smsWebhookConnected: true,
        telnyxMessagingProfileId: 'profile-provider-launch-proof',
        telnyx10dlc: {
          numberAssigned: true,
          campaignActive: true,
          checkedAt: now,
          brandStatus: 'VERIFIED',
          brandVerified: true,
          campaignStatus: 'MNO_ACCEPTED',
          intendedUsecase: 'CUSTOMER_CARE',
          usecaseQualificationChecked: true,
          usecaseQualified: true,
          usecaseQualificationUsecase: 'CUSTOMER_CARE',
          usecaseQualificationFees: { monthly: 10, quarterly: 30, annual: 120 },
          summary: 'Telnyx number is assigned to an approved campaign.'
        },
        lastTelnyxDeliveryEvidenceAt: now,
        lastTelnyxInboundEvidenceAt: now,
        lastAiHealthAt: now,
        lastAiHealthStatus: 'OpenAI answered through the Responses API and Star sanitized the plan.',
        lastAiProvider: 'openai',
        lastAiProviderError: ''
      }
    }
  };
  data.integrations.messaging.lastTelnyxDeliveryConfigurationFingerprint = messagingLaunchConfigurationFingerprint(data);
  data.integrations.messaging.lastTelnyxInboundConfigurationFingerprint = messagingLaunchConfigurationFingerprint(data);
  data.integrations.messaging.lastAiHealthConfigurationFingerprint = starAiLaunchConfigurationFingerprint(data);
  const emailFingerprint = emailLaunchConfigurationFingerprint(data);
  data.messages.push(
    {
      id: 'resend-outbound-proof',
      externalId: 're_outbound_proof',
      provider: 'resend',
      providerConfigurationFingerprint: emailFingerprint,
      channel: 'Email',
      direction: 'Outbound notification',
      source: 'WheelsonAuto email notification',
      status: 'Sent',
      createdAt: now
    },
    {
      id: 'resend-inbound-proof',
      externalId: 're_inbound_proof',
      provider: 'resend',
      providerConfigurationFingerprint: emailFingerprint,
      channel: 'Email',
      direction: 'Inbound',
      source: 'Email webhook',
      status: 'Received',
      createdAt: now,
      receivedAt: now
    }
  );
  return data;
}

const data = readyState();
const stripeFingerprint = stripeWebhookConfigurationFingerprint();
const stripeAccountFingerprint = stripeAccountConfigurationFingerprint();
data.integrations.stripe = {
  lastAccountHealthAt: new Date().toISOString(),
  lastAccountHealthSuccess: true,
  lastAccountHealthKeyMode: 'live',
  lastAccountId: 'acct_provider_launch_proof',
  lastAccountCountry: 'US',
  lastAccountChargesEnabled: true,
  lastAccountPayoutsEnabled: true,
  lastAccountDetailsSubmitted: true,
  lastAccountRequirementsCurrentlyDueCount: 0,
  lastAccountRequirementsPastDueCount: 0,
  lastAccountDisabledReason: '',
  lastAccountHealthConfigurationFingerprint: stripeAccountFingerprint,
  lastAccountHealthError: '',
  lastLaunchWebhookAt: new Date().toISOString(),
  lastLaunchWebhookType: 'payment_intent.succeeded',
  lastLaunchWebhookEventId: 'evt_live_provider_launch_payment',
  lastLaunchWebhookLivemode: true,
  lastLaunchWebhookConfigurationFingerprint: stripeFingerprint,
  lastIdentityWebhookAt: new Date().toISOString(),
  lastIdentityWebhookType: 'identity.verification_session.verified',
  lastIdentityWebhookEventId: 'evt_live_provider_launch_identity',
  lastIdentityWebhookLivemode: true,
  lastIdentityWebhookConfigurationFingerprint: stripeFingerprint
};

assert.strictEqual(usesVerifiedWheelsonAutoSendingDomain('WheelsonAuto <notifications@wheelsonauto.com>'), true, 'The verified root sending domain must remain valid.');
assert.strictEqual(usesVerifiedWheelsonAutoSendingDomain('WheelsonAuto <notifications@notify.wheelsonauto.com>'), true, 'A verified WheelsonAuto sending subdomain must satisfy the launch gate.');
assert.strictEqual(usesVerifiedWheelsonAutoSendingDomain('notifications@alerts.notify.wheelsonauto.com.'), true, 'Nested WheelsonAuto subdomains and a normalized terminal dot should remain valid.');
assert.strictEqual(usesVerifiedWheelsonAutoSendingDomain('notifications@wheelsonauto.com.example.test'), false, 'A lookalike domain containing wheelsonauto.com must fail closed.');
assert.strictEqual(usesVerifiedWheelsonAutoSendingDomain('notifications@fakewheelsonauto.com'), false, 'A suffix lookalike domain must fail closed.');
assert.strictEqual(usesVerifiedWheelsonAutoSendingDomain('wheelsonauto@gmail.com'), false, 'An external mailbox must not masquerade as the verified sending domain.');

const telnyx = telnyxLiveLaunchEvidence(data);
assert.strictEqual(telnyx.live, true, 'Telnyx launch proof must require a connected profile, active 10DLC campaign, carrier delivery, and signed inbound evidence.');
assert.strictEqual(telnyx.deliveryVerified, true);
assert.strictEqual(telnyx.inboundVerified, true);
assert.strictEqual(telnyx.provider, 'telnyx');
assert.strictEqual(telnyx.brandVerified, true);
assert.strictEqual(telnyx.numberAssigned, true);
assert.deepStrictEqual(telnyx.carrierUsecaseQualificationFees, { monthly: 10, quarterly: 30, annual: 120 }, 'Owner preflight may expose carrier pricing without exposing Telnyx credentials.');

const staleTelnyx = clone(data);
staleTelnyx.integrations.messaging.lastTelnyxInboundConfigurationFingerprint = 'stale-proof';
assert.strictEqual(telnyxLiveLaunchEvidence(staleTelnyx).live, false, 'A Telnyx proof from another configuration must not unlock the launch gate.');
const rejectedTelnyx = clone(data);
rejectedTelnyx.integrations.messaging.telnyx10dlc = {
  checkedAt: new Date().toISOString(),
  numberAssigned: false,
  campaignActive: false,
  campaignStatus: 'Not found',
  historicalCampaignStatus: 'TCR_FAILED',
  historicalFailureReason: 'Brand does not qualify for submitted campaign use-case.',
  registrationStage: 'campaign_creation'
};
const rejectedTelnyxEvidence = telnyxLiveLaunchEvidence(rejectedTelnyx);
assert.strictEqual(rejectedTelnyxEvidence.live, false, 'A rejected 10DLC campaign must keep the live launch gate closed.');
assert.match(rejectedTelnyxEvidence.error, /Brand does not qualify for submitted campaign use-case/, 'The live launch gate must preserve the actionable Telnyx carrier rejection reason.');
assert.strictEqual(rejectedTelnyxEvidence.carrierRegistrationStage, 'campaign_creation', 'The Telnyx launch evidence must expose the current corrective stage without exposing secrets.');

const qualifiedReplacementTelnyx = clone(data);
qualifiedReplacementTelnyx.integrations.messaging.telnyx10dlc = {
  checkedAt: new Date().toISOString(),
  numberAssigned: false,
  campaignActive: false,
  campaignStatus: 'Not found',
  brandStatus: 'VERIFIED',
  brandVerified: true,
  historicalCampaignStatus: 'TCR_FAILED',
  historicalCampaignUsecase: 'LOW_VOLUME',
  historicalFailureReason: 'Brand does not qualify for submitted campaign use-case.',
  intendedUsecase: 'CUSTOMER_CARE',
  usecaseQualificationChecked: true,
  usecaseQualified: true,
  usecaseQualificationUsecase: 'CUSTOMER_CARE',
  resubmissionBlocked: false,
  registrationStage: 'campaign_creation'
};
const qualifiedReplacementTelnyxEvidence = telnyxLiveLaunchEvidence(qualifiedReplacementTelnyx);
assert.strictEqual(qualifiedReplacementTelnyxEvidence.live, false, 'A qualified replacement use case still needs an approved campaign, assigned number, and delivery proof.');
assert.match(qualifiedReplacementTelnyxEvidence.error, /qualifies for CUSTOMER_CARE.*corrected campaign/i, 'The launch gate should show the qualified corrective path instead of repeating the historical rejection.');
assert.doesNotMatch(qualifiedReplacementTelnyxEvidence.error, /blocked by the carrier rejection/i, 'Historical rejection text must not contradict a passed replacement-use-case qualification.');
assert.strictEqual(qualifiedReplacementTelnyxEvidence.carrierUsecaseQualified, true);
assert.strictEqual(qualifiedReplacementTelnyxEvidence.carrierUsecaseQualificationUsecase, 'CUSTOMER_CARE');

const resend = resendLiveLaunchEvidence(data);
assert.strictEqual(resend.live, true, 'Resend launch proof must require the verified WheelsonAuto sender plus fresh outbound and inbound provider evidence.');
assert.strictEqual(resend.senderDomainVerified, true);
assert.strictEqual(resend.senderDomain, 'notify.wheelsonauto.com');
assert.strictEqual(resend.outboundVerified, true);
assert.strictEqual(resend.inboundVerified, true);

const staleResend = clone(data);
staleResend.messages.find(record => record.id === 'resend-inbound-proof').providerConfigurationFingerprint = 'stale-proof';
assert.strictEqual(resendLiveLaunchEvidence(staleResend).live, false, 'An inbound Resend proof from another configuration must not unlock the launch gate.');

const star = starAiLiveLaunchEvidence(data);
assert.strictEqual(star.live, true, 'Star launch proof must require an operational OpenAI health result tied to the current settings.');
assert.strictEqual(star.dailyLimit, 50);
assert.strictEqual(star.monthlyLimit, 500);
assert.strictEqual(star.provider, 'openai');
assert.strictEqual(star.model, 'gpt-5.4-nano');
assert.strictEqual(star.autoSendEnabled, false);
assert.strictEqual(star.draftsEnabled, true);
assert.strictEqual(star.dailyRemaining, 50);

const staleStar = clone(data);
staleStar.integrations.messaging.lastAiHealthConfigurationFingerprint = 'stale-proof';
assert.strictEqual(starAiLiveLaunchEvidence(staleStar).live, false, 'An OpenAI health proof from another configuration must not unlock the launch gate.');

const stripePayment = stripeLiveWebhookEvidence(data);
assert.strictEqual(stripePayment.live, true, 'Stripe payment launch proof must require a fresh matched live financial event tied to the current Stripe configuration.');
assert.strictEqual(stripePayment.relevantEvent, true);
assert.strictEqual(stripePayment.fresh, true);

const stripeAccount = stripeAccountLiveEvidence(data);
assert.strictEqual(stripeAccount.live, true, 'Stripe account proof must require a fresh live-mode account check with charges, payouts, and business details enabled.');
assert.strictEqual(stripeAccount.chargesEnabled, true);
assert.strictEqual(stripeAccount.payoutsEnabled, true);
assert.strictEqual(stripeAccount.detailsSubmitted, true);
assert.strictEqual(stripeAccount.provider, 'stripe');
assert.strictEqual(stripeAccount.keyMode, 'live');
assert.strictEqual(stripeAccount.configured, true);

const stripeChargesDisabled = clone(data);
stripeChargesDisabled.integrations.stripe.lastAccountChargesEnabled = false;
assert.strictEqual(stripeAccountLiveEvidence(stripeChargesDisabled).live, false, 'A Stripe account with charges disabled must not unlock launch.');
assert.match(stripeAccountLiveEvidence(stripeChargesDisabled).error, /not enabled charges/i);

const stripePayoutsDisabled = clone(data);
stripePayoutsDisabled.integrations.stripe.lastAccountPayoutsEnabled = false;
assert.strictEqual(stripeAccountLiveEvidence(stripePayoutsDisabled).live, false, 'A Stripe account with payouts disabled must not unlock launch.');

const stripeOnboardingIncomplete = clone(data);
stripeOnboardingIncomplete.integrations.stripe.lastAccountDetailsSubmitted = false;
assert.strictEqual(stripeAccountLiveEvidence(stripeOnboardingIncomplete).live, false, 'Incomplete Stripe business onboarding must not unlock launch.');

const staleStripeAccount = clone(data);
staleStripeAccount.integrations.stripe.lastAccountHealthAt = '2020-01-01T00:00:00.000Z';
assert.strictEqual(stripeAccountLiveEvidence(staleStripeAccount).live, false, 'Expired Stripe account activation proof must require another read-only check.');

const mismatchedStripeAccount = clone(data);
mismatchedStripeAccount.integrations.stripe.lastAccountHealthConfigurationFingerprint = 'stale-proof';
assert.strictEqual(stripeAccountLiveEvidence(mismatchedStripeAccount).live, false, 'Stripe account evidence from another key configuration must not unlock launch.');

const unrelatedStripe = clone(data);
unrelatedStripe.integrations.stripe.lastLaunchWebhookType = 'customer.updated';
assert.strictEqual(stripeLiveWebhookEvidence(unrelatedStripe).live, false, 'An unrelated signed Stripe event must not unlock the payment launch gate.');

const staleStripe = clone(data);
staleStripe.integrations.stripe.lastLaunchWebhookAt = '2020-01-01T00:00:00.000Z';
assert.strictEqual(stripeLiveWebhookEvidence(staleStripe).live, false, 'Expired Stripe payment evidence must require a new matched live event.');

const stripeIdentity = stripeIdentityLiveWebhookEvidence(data);
assert.strictEqual(stripeIdentity.live, true, 'Stripe Identity launch proof must require a fresh signed live verified event tied to the current Stripe configuration.');
assert.strictEqual(stripeIdentity.fresh, true);

const staleIdentity = clone(data);
staleIdentity.integrations.stripe.lastIdentityWebhookAt = '2020-01-01T00:00:00.000Z';
assert.strictEqual(stripeIdentityLiveWebhookEvidence(staleIdentity).live, false, 'Expired Stripe Identity evidence must require a new live license and selfie verification.');

const ownerRead = stateForUserRead(data, { role: 'Owner', organizationId: 'org-wheelsonauto' });
assert.strictEqual(Object.prototype.hasOwnProperty.call(ownerRead.messages.find(record => record.id === 'resend-inbound-proof'), 'providerConfigurationFingerprint'), false, 'Provider proof fingerprints must never be returned to the browser state.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ownerRead.integrations.messaging, 'lastAiHealthConfigurationFingerprint'), false, 'Integration proof fingerprints must never be returned to the browser state.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ownerRead.integrations.stripe, 'lastLaunchWebhookConfigurationFingerprint'), false, 'Stripe payment proof fingerprints must never be returned to browser state.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ownerRead.integrations.stripe, 'lastIdentityWebhookConfigurationFingerprint'), false, 'Stripe Identity proof fingerprints must never be returned to browser state.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ownerRead.integrations.stripe, 'lastAccountHealthConfigurationFingerprint'), false, 'Stripe account proof fingerprints must never be returned to browser state.');

const forgedState = clone(data);
forgedState.integrations.stripe.lastAccountChargesEnabled = false;
forgedState.integrations.stripe.lastAccountPayoutsEnabled = false;
forgedState.integrations.stripe.lastAccountHealthConfigurationFingerprint = 'forged-account-proof';
forgedState.messages.find(record => record.id === 'resend-inbound-proof').providerConfigurationFingerprint = 'forged-proof';
forgedState.messages.push({
  id: 'forged-provider-proof',
  externalId: 'forged-provider-proof',
  provider: 'resend',
  providerConfigurationFingerprint: emailLaunchConfigurationFingerprint(data),
  channel: 'Email',
  direction: 'Inbound',
  source: 'Email webhook',
  status: 'Received',
  createdAt: new Date().toISOString()
});
const ownerWrite = stateForUserWrite(data, forgedState, { role: 'Owner', organizationId: 'org-wheelsonauto' });
assert.strictEqual(ownerWrite.messages.find(record => record.id === 'resend-inbound-proof').providerConfigurationFingerprint, data.messages.find(record => record.id === 'resend-inbound-proof').providerConfigurationFingerprint, 'Browser writes must preserve existing provider evidence instead of replacing it.');
assert.strictEqual(Object.prototype.hasOwnProperty.call(ownerWrite.messages.find(record => record.id === 'forged-provider-proof'), 'providerConfigurationFingerprint'), false, 'Browser writes must not create a new provider proof fingerprint.');
assert.strictEqual(ownerWrite.integrations.stripe.lastLaunchWebhookConfigurationFingerprint, stripeFingerprint, 'Browser writes must preserve the server-only Stripe payment proof fingerprint.');
assert.strictEqual(ownerWrite.integrations.stripe.lastIdentityWebhookConfigurationFingerprint, stripeFingerprint, 'Browser writes must preserve the server-only Stripe Identity proof fingerprint.');
assert.strictEqual(ownerWrite.integrations.stripe.lastAccountHealthConfigurationFingerprint, stripeAccountFingerprint, 'Browser writes must preserve the server-only Stripe account proof fingerprint.');
assert.strictEqual(ownerWrite.integrations.stripe.lastAccountChargesEnabled, true, 'Browser writes must not forge or clear the server-verified Stripe account readiness values.');
assert.strictEqual(ownerWrite.integrations.stripe.lastAccountPayoutsEnabled, true, 'Browser writes must not forge or clear the server-verified Stripe payout readiness value.');

console.log('Provider launch proof check passed: Stripe account activation, Stripe payments, Stripe Identity, Telnyx, Resend, and Star require fresh evidence tied to the current secured configuration.');
