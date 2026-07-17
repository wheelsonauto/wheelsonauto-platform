'use strict';

const assert = require('node:assert');

process.env.WOA_SESSION_SECRET = 'provider-launch-proof-session-secret';
process.env.WOA_MESSAGING_PROVIDER = 'telnyx';
process.env.WOA_MESSAGING_FROM_NUMBER = '+16095550199';
process.env.WOA_MESSAGING_WEBHOOK_SECRET = 'provider-launch-proof-webhook-secret';
process.env.TELNYX_API_KEY = 'KEY-provider-launch-proof';
process.env.TELNYX_PUBLIC_KEY = 'provider-launch-proof-public-key';
process.env.TELNYX_MESSAGING_PROFILE_ID = 'profile-provider-launch-proof';
process.env.WOA_EMAIL_PROVIDER = 'resend';
process.env.WOA_EMAIL_FROM = 'WheelsonAuto <notifications@wheelsonauto.com>';
process.env.RESEND_API_KEY = 're_provider_launch_proof';
process.env.RESEND_WEBHOOK_SECRET = 'whsec_provider_launch_proof';
process.env.OPENAI_API_KEY = 'sk-provider-launch-proof';
process.env.WOA_AI_MODEL = 'gpt-5.4-nano';
process.env.WOA_AI_MAX_REQUESTS_PER_DAY = '50';
process.env.WOA_AI_MAX_REQUESTS_PER_MONTH = '500';

const {
  messagingLaunchConfigurationFingerprint,
  emailLaunchConfigurationFingerprint,
  starAiLaunchConfigurationFingerprint,
  telnyxLiveLaunchEvidence,
  resendLiveLaunchEvidence,
  starAiLiveLaunchEvidence
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
          campaignStatus: 'MNO_ACCEPTED',
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

const telnyx = telnyxLiveLaunchEvidence(data);
assert.strictEqual(telnyx.live, true, 'Telnyx launch proof must require a connected profile, active 10DLC campaign, carrier delivery, and signed inbound evidence.');
assert.strictEqual(telnyx.deliveryVerified, true);
assert.strictEqual(telnyx.inboundVerified, true);

const staleTelnyx = clone(data);
staleTelnyx.integrations.messaging.lastTelnyxInboundConfigurationFingerprint = 'stale-proof';
assert.strictEqual(telnyxLiveLaunchEvidence(staleTelnyx).live, false, 'A Telnyx proof from another configuration must not unlock the launch gate.');

const resend = resendLiveLaunchEvidence(data);
assert.strictEqual(resend.live, true, 'Resend launch proof must require the verified WheelsonAuto sender plus fresh outbound and inbound provider evidence.');
assert.strictEqual(resend.senderDomainVerified, true);
assert.strictEqual(resend.outboundVerified, true);
assert.strictEqual(resend.inboundVerified, true);

const staleResend = clone(data);
staleResend.messages.find(record => record.id === 'resend-inbound-proof').providerConfigurationFingerprint = 'stale-proof';
assert.strictEqual(resendLiveLaunchEvidence(staleResend).live, false, 'An inbound Resend proof from another configuration must not unlock the launch gate.');

const star = starAiLiveLaunchEvidence(data);
assert.strictEqual(star.live, true, 'Star launch proof must require an operational OpenAI health result tied to the current settings.');
assert.strictEqual(star.dailyLimit, 50);
assert.strictEqual(star.monthlyLimit, 500);

const staleStar = clone(data);
staleStar.integrations.messaging.lastAiHealthConfigurationFingerprint = 'stale-proof';
assert.strictEqual(starAiLiveLaunchEvidence(staleStar).live, false, 'An OpenAI health proof from another configuration must not unlock the launch gate.');

console.log('Provider launch proof check passed: Telnyx, Resend, and Star require fresh evidence tied to the current secured configuration.');
