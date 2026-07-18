const assert = require('node:assert');
const crypto = require('node:crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const publicKeyBase64 = publicDer.subarray(publicDer.length - 32).toString('base64');

process.env.WOA_MESSAGING_PROVIDER = 'telnyx';
process.env.WOA_MESSAGING_FROM_NUMBER = '+16095550199';
process.env.TELNYX_API_KEY = 'KEY-test';
process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;

const {
  publicMessagingStatus,
  verifyTelnyxWebhook,
  parseIncomingMessage,
  sendProviderSms,
  applyTelnyxDeliveryEvent,
  telnyxCarrierReadiness,
  mergeTelnyxDeliveryUpdates,
  reconcileTelnyxDeliveryRecords,
  configureTelnyxMessagingProfile,
  checkTelnyx10dlcReadiness,
  assignTelnyx10dlcCampaign
} = require('../server');

function signedHeaders(rawBody, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = crypto.sign(null, Buffer.from(timestamp + '|' + rawBody), privateKey).toString('base64');
  return { 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature };
}

(async () => {
  const inboundPayload = {
    data: {
      event_type: 'message.received',
      payload: {
        id: 'telnyx-inbound-1',
        from: { phone_number: '+16095550101' },
        to: [{ phone_number: '+16095550199' }],
        text: 'Can I bring the car in Tuesday?'
      }
    }
  };
  const rawInbound = JSON.stringify(inboundPayload);
  const headers = signedHeaders(rawInbound);
  assert(verifyTelnyxWebhook(rawInbound, headers), 'A valid Telnyx Ed25519 webhook signature should pass.');
  assert(!verifyTelnyxWebhook(rawInbound + 'x', headers), 'A changed Telnyx payload should fail signature verification.');
  assert(!verifyTelnyxWebhook(rawInbound, signedHeaders(rawInbound, String(Math.floor(Date.now() / 1000) - 600))), 'A stale Telnyx webhook should fail signature verification.');

  const inbound = parseIncomingMessage('telnyx', headers, inboundPayload);
  assert.strictEqual(inbound.from, '+16095550101');
  assert.strictEqual(inbound.to, '+16095550199');
  assert.strictEqual(inbound.body, 'Can I bring the car in Tuesday?');
  assert.strictEqual(inbound.externalId, 'telnyx-inbound-1');

  let outboundRequest = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    outboundRequest = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: { id: 'telnyx-outbound-1', to: [{ phone_number: '+16095550102', status: 'queued' }] } };
      }
    };
  };
  const outbound = await sendProviderSms('+16095550102', 'WheelsonAuto Telnyx test');
  global.fetch = originalFetch;
  assert(outbound.sent && outbound.provider === 'telnyx' && outbound.externalId === 'telnyx-outbound-1');
  const outboundBody = JSON.parse(outboundRequest.options.body);
  assert.strictEqual(outboundBody.webhook_url, 'https://wheelsonauto-platform.onrender.com/api/webhooks/messages?provider=telnyx');
  assert.strictEqual(outboundBody.use_profile_webhooks, true);
  assert.strictEqual(outboundBody.auto_detect, true);
  assert.strictEqual(outboundBody.encoding, 'auto');

  const messageData = {
    messages: [{ id: 'message-local-1', externalId: 'telnyx-outbound-1', status: 'Queued', tone: 'blue' }]
  };
  const delivery = applyTelnyxDeliveryEvent(messageData, {
    data: {
      event_type: 'message.finalized',
      payload: {
        id: 'telnyx-outbound-1',
        to: [{ phone_number: '+16095550102', status: 'delivered' }],
        cost: { amount: '0.0040', currency: 'USD' }
      }
    }
  });
  assert(delivery.matched, 'Telnyx delivery event should match the outbound message by provider ID.');
  assert.strictEqual(messageData.messages[0].status, 'Delivered');
  assert.strictEqual(messageData.messages[0].tone, 'good');
  assert.strictEqual(messageData.messages[0].providerStatus, 'delivered');

  const failedMessageData = {
    messages: [{ id: 'message-local-2', externalId: 'telnyx-outbound-2', provider: 'telnyx', createdAt: new Date(Date.now() - 10000).toISOString(), status: 'queued', tone: 'blue' }]
  };
  const reconciled = await reconcileTelnyxDeliveryRecords(failedMessageData, {
    apiKey: 'KEY-test',
    minAgeMs: 0,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: { id: 'telnyx-outbound-2', to: [{ phone_number: '+16095550102', status: 'delivery_failed' }], errors: [{ code: '40010', title: 'Unregistered 10DLC Message' }] } };
      }
    })
  });
  assert.strictEqual(reconciled.checked, 1);
  assert.strictEqual(reconciled.updated, 1);
  assert.strictEqual(failedMessageData.messages[0].status, 'Failed');
  assert.strictEqual(failedMessageData.messages[0].providerErrorCode, '40010');
  assert.match(failedMessageData.messages[0].providerErrorMessage, /10DLC registration required/);
  const failedReadiness = telnyxCarrierReadiness(failedMessageData, 'telnyx');
  assert.strictEqual(failedReadiness.carrierDeliveryVerified, false);
  assert.strictEqual(failedReadiness.carrierRegistrationRequired, true);
  assert.strictEqual(failedReadiness.carrierDeliveryErrorCode, '40010');
  const deliveredReadiness = telnyxCarrierReadiness(messageData, 'telnyx');
  assert.strictEqual(deliveredReadiness.carrierDeliveryVerified, true);
  assert.strictEqual(deliveredReadiness.carrierRegistrationRequired, false);
  const failedPublicStatus = publicMessagingStatus(failedMessageData);
  assert.strictEqual(failedPublicStatus.configured, true, 'Telnyx credentials and number should remain separately marked as configured.');
  assert.strictEqual(failedPublicStatus.smsDeliveryLive, false, 'A 10DLC rejection must never be presented as live SMS.');
  assert.strictEqual(failedPublicStatus.carrierRegistrationRequired, true);
  const deliveredPublicStatus = publicMessagingStatus(messageData);
  assert.strictEqual(deliveredPublicStatus.smsDeliveryLive, true, 'A carrier-confirmed delivery should unlock the live SMS state.');

  const latestLiveData = {
    messages: [{ id: 'message-local-2', externalId: 'telnyx-outbound-2', provider: 'telnyx', customer: 'Latest customer name', vehicleId: 'vehicle-latest', status: 'queued', tone: 'blue' }]
  };
  const mergedDeliveryCount = mergeTelnyxDeliveryUpdates(latestLiveData, failedMessageData);
  assert.strictEqual(mergedDeliveryCount, 1, 'The final Telnyx result should merge into the latest saved message.');
  assert.strictEqual(latestLiveData.messages[0].status, 'Failed');
  assert.strictEqual(latestLiveData.messages[0].providerErrorCode, '40010');
  assert.strictEqual(latestLiveData.messages[0].customer, 'Latest customer name', 'Delivery reconciliation must preserve newer customer details.');
  assert.strictEqual(latestLiveData.messages[0].vehicleId, 'vehicle-latest', 'Delivery reconciliation must preserve newer vehicle links.');
  const repeatedDeliveryCount = mergeTelnyxDeliveryUpdates(latestLiveData, failedMessageData);
  assert.strictEqual(repeatedDeliveryCount, 0, 'An unchanged carrier result must not rewrite live data every poll.');

  const staleQueuedData = {
    messages: [{ id: 'message-local-3', externalId: 'telnyx-outbound-3', provider: 'telnyx', createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), status: 'queued', tone: 'blue' }]
  };
  applyTelnyxDeliveryEvent(staleQueuedData, { data: { event_type: 'message.sent', payload: { id: 'telnyx-outbound-3', to: [{ status: 'queued' }] } } });
  assert.strictEqual(staleQueuedData.messages[0].status, 'Delivery pending review', 'A stale queued message must not be mislabeled as sent.');
  assert.strictEqual(staleQueuedData.messages[0].tone, 'warn');

  const calls = [];
  const configured = await configureTelnyxMessagingProfile({
    apiKey: 'KEY-test',
    publicKey: publicKeyBase64,
    phoneNumber: '+16095550199',
    profileId: 'profile-test',
    webhookUrl: 'https://wheelsonauto-platform.onrender.com/api/webhooks/messages?provider=telnyx',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/phone_numbers?')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { data: [{ id: 'number-test', phone_number: '+16095550199', messaging_profile_id: '' }] };
          }
        };
      }
      return { ok: true, status: 200, async json() { return { data: { id: 'profile-test' } }; } };
    }
  });
  assert(configured.connected && configured.provider === 'telnyx' && configured.assigned, 'Telnyx setup should connect the signed inbox and assign the number.');
  assert(calls.some(call => call.options.method === 'PATCH' && call.url.endsWith('/messaging_profiles/profile-test')), 'Telnyx setup should update the messaging profile webhook.');
  const profileUpdate = calls.find(call => call.options.method === 'PATCH');
  const profileBody = JSON.parse(profileUpdate.options.body);
  assert.strictEqual(profileBody.webhook_api_version, '2');
  assert.strictEqual(profileBody.smart_encoding, true);
  assert(calls.some(call => call.options.method === 'POST' && call.url.endsWith('/messaging_profiles/profile-test/phone_numbers')), 'Telnyx setup should assign the test number to the profile.');

  const activeRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      if (String(url).includes('/10dlc/phone_number_campaigns/%2B16095550199')) {
        return { ok: true, status: 200, async json() { return { phoneNumber: '+16095550199', campaignId: 'campaign-active', assignmentStatus: 'ASSIGNED' }; } };
      }
      if (String(url).endsWith('/10dlc/campaignBuilder/campaign-active')) {
        return { ok: true, status: 200, async json() { return { data: { campaignId: 'campaign-active', status: 'ACTIVE' } }; } };
      }
      throw new Error('Unexpected Telnyx readiness URL: ' + url);
    }
  });
  assert(activeRegistration.numberAssigned && activeRegistration.campaignActive && activeRegistration.readyForDeliveryTest, 'Active 10DLC campaign plus number assignment should unlock the outbound delivery test.');
  const staleFailureWithActiveRegistration = {
    integrations: { messaging: { telnyx10dlc: activeRegistration } },
    messages: [{ provider: 'telnyx', providerStatus: 'delivery_failed', providerErrorCode: '40010', providerErrorMessage: 'Old registration failure', deliveryUpdatedAt: '2026-07-15T12:00:00.000Z' }]
  };
  const registrationOverride = telnyxCarrierReadiness(staleFailureWithActiveRegistration, 'telnyx');
  assert(registrationOverride.carrierRegistrationVerified && !registrationOverride.carrierRegistrationRequired && !registrationOverride.carrierDeliveryVerified, 'Fresh active campaign evidence should clear a stale 10DLC blocker without pretending carrier delivery already passed.');
  const missingRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      if (String(url).includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (String(url).includes('/10dlc/campaignBuilder?')) return { ok: true, status: 200, async json() { return { data: [] }; } };
      if (String(url).includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [] }; } };
      throw new Error('Unexpected missing readiness URL: ' + url);
    }
  });
  assert(!missingRegistration.numberAssigned && !missingRegistration.campaignActive && !missingRegistration.readyForDeliveryTest, 'Unassigned Telnyx numbers must remain blocked from live SMS.');
  const fallbackRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'The requested resource or URL could not be found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [{ brandId: 'brand-live', identityStatus: 'VERIFIED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-live')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-fallback', status: 'ACTIVE' }] }; } };
      throw new Error('Unexpected fallback readiness URL: ' + url);
    }
  });
  assert(!fallbackRegistration.numberAssigned && fallbackRegistration.campaignActive && fallbackRegistration.campaignId === 'campaign-fallback' && fallbackRegistration.brandStatus === 'VERIFIED', 'Brand and campaign API fallback should find an approved campaign when campaignBuilder is unavailable.');
  const pendingRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'The requested resource or URL could not be found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [{ brandId: 'brand-pending', identityStatus: 'VERIFIED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-pending')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-pending', campaignStatus: 'MNO_PENDING' }] }; } };
      throw new Error('Unexpected pending readiness URL: ' + url);
    }
  });
  assert(!pendingRegistration.campaignActive && pendingRegistration.campaignStatus === 'MNO_PENDING' && /MNO_PENDING/.test(pendingRegistration.summary), 'Pending carrier review must be reported without exposing assignment controls.');
  const failedRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'The requested resource or URL could not be found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [{ brandId: 'brand-failed', identityStatus: 'VERIFIED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-failed')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-failed', status: 'ACTIVE', campaignStatus: 'TCR_FAILED', failureReasons: 'Opt-in description must identify the exact customer consent flow.' }] }; } };
      throw new Error('Unexpected failed readiness URL: ' + url);
    }
  });
  assert(!failedRegistration.campaignActive && failedRegistration.campaignStatus === 'Not found' && failedRegistration.historicalCampaignStatus === 'TCR_FAILED', 'A rejected campaign must remain history instead of becoming the current campaign.');
  assert(failedRegistration.registrationStage === 'campaign_creation' && /Create the corrected campaign/.test(failedRegistration.summary), 'A verified brand with only a rejected campaign must advance to corrected campaign creation.');
  assert(/exact customer consent flow/.test(failedRegistration.historicalFailureReason), 'Historical Telnyx failure reasons must remain available for diagnosis.');
  assert(/exact customer consent flow/.test(failedRegistration.summary) && /exact customer consent flow/.test(failedRegistration.nextAction), 'A rejected Telnyx campaign must show its exact carrier reason in both the saved status and next action.');
  const unverifiedBrandRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Not found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [{ brandId: 'brand-review', identityStatus: 'UNVERIFIED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-review')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-old', campaignStatus: 'TCR_FAILED', failureReasons: 'Brand does not qualify.' }] }; } };
      throw new Error('Unexpected unverified readiness URL: ' + url);
    }
  });
  assert(unverifiedBrandRegistration.registrationStage === 'brand_verification' && !unverifiedBrandRegistration.brandVerified && /history only/.test(unverifiedBrandRegistration.summary), 'An unverified brand must be the current blocker while its rejected campaign remains history.');
  const mixedBrandRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Not found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [
        { brandId: 'brand-older', identityStatus: 'UNVERIFIED' },
        { brandId: 'brand-current', identityStatus: 'VERIFIED' }
      ] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-older')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-old', campaignStatus: 'TCR_FAILED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-current')) return { ok: true, status: 200, async json() { return { records: [] }; } };
      throw new Error('Unexpected mixed-brand readiness URL: ' + url);
    }
  });
  assert(mixedBrandRegistration.brandVerified && mixedBrandRegistration.registrationStage === 'campaign_creation', 'A verified current brand must take precedence over older unverified brand records.');
  const assignmentCalls = [];
  const candidateRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      if (String(url).includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (String(url).includes('/10dlc/campaignBuilder?')) return { ok: true, status: 200, async json() { return { data: [{ campaignId: 'campaign-candidate', status: 'ACTIVE' }] }; } };
      if (String(url).includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [] }; } };
      throw new Error('Unexpected candidate readiness URL: ' + url);
    }
  });
  assert(!candidateRegistration.numberAssigned && candidateRegistration.campaignActive && candidateRegistration.campaignId === 'campaign-candidate', 'An active unassigned campaign should become a safe assignment candidate without pretending the number is attached.');
  const submittedAssignment = await assignTelnyx10dlcCampaign({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    readiness: candidateRegistration,
    fetchImpl: async (url, options = {}) => {
      assignmentCalls.push({ url: String(url), options });
      return { ok: true, status: 202, async json() { return { data: { status: 'pending' } }; } };
    }
  });
  assert(submittedAssignment.assignmentStatus === 'Assignment submitted' && submittedAssignment.assignmentRequestedAt, 'Owner assignment should record a pending Telnyx number-to-campaign request.');
  assert(assignmentCalls.length === 1 && assignmentCalls[0].url.endsWith('/10dlc/phone_number_campaigns/%2B16095550199') && assignmentCalls[0].options.method === 'PUT', '10DLC assignment should use the official phone-number campaign endpoint.');
  assert.deepStrictEqual(JSON.parse(assignmentCalls[0].options.body), { phoneNumber: '+16095550199', campaignId: 'campaign-candidate' });

  console.log('Telnyx messaging check passed: signed inbound webhooks, message parsing, delivery receipts, profile setup, and live 10DLC readiness checks are wired.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
