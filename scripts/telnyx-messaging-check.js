const assert = require('node:assert');
const crypto = require('node:crypto');
const stateRepository = require('../state-repository');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const publicKeyBase64 = publicDer.subarray(publicDer.length - 32).toString('base64');

process.env.WOA_MESSAGING_PROVIDER = 'telnyx';
process.env.WOA_MESSAGING_ENABLED = '1';
process.env.WOA_MESSAGING_FROM_NUMBER = '+16095550199';
process.env.TELNYX_API_KEY = 'KEY-test';
process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;

const {
  publicMessagingStatus,
  verifyTelnyxWebhook,
  parseIncomingMessage,
  sendProviderSms,
  reviewPendingSmsDelivery,
  applyTelnyxDeliveryEvent,
  telnyxCarrierReadiness,
  mergeTelnyxDeliveryUpdates,
  reconcileTelnyxDeliveryRecords,
  configureTelnyxMessagingProfile,
  checkTelnyx10dlcReadiness,
  telnyxCustomerCareCampaignDraft,
  telnyxCampaignSubmissionClaimRequest,
  claimTelnyxCampaignSubmission,
  telnyxCampaignSubmissionSettlement,
  submitTelnyxCustomerCareCampaign,
  publicTelnyxCampaignSubmission,
  assignTelnyx10dlcCampaign
} = require('../server');

const transactionalSmsRepository = stateRepository.createStateRepository({
  backend: 'json',
  organizationId: 'org-wheelsonauto-sms-test'
});
transactionalSmsRepository.isTransactional = () => true;
const transactionalSmsDependencies = { repository: transactionalSmsRepository };

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

  const originalFetch = global.fetch;
  let jsonBackendProviderCalls = 0;
  global.fetch = async () => {
    jsonBackendProviderCalls += 1;
    throw new Error('The provider must not be called from the JSON backend.');
  };
  const jsonBackendBlocked = await sendProviderSms('+16095550198', 'JSON backend launch guard', { deliveryId: 'telnyx-json-backend-guard-1' });
  global.fetch = originalFetch;
  assert.strictEqual(jsonBackendBlocked.sent, false, 'Live SMS must remain a draft on the restart-unsafe JSON backend.');
  assert.strictEqual(jsonBackendBlocked.status, 'PostgreSQL required');
  assert.match(jsonBackendBlocked.message, /server restart cannot send the same customer text twice/i);
  assert.strictEqual(jsonBackendProviderCalls, 0, 'The JSON backend launch guard must block before any carrier request.');

  let outboundRequest = null;
  let outboundRequestCount = 0;
  global.fetch = async (url, options = {}) => {
    outboundRequestCount += 1;
    outboundRequest = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: { id: 'telnyx-outbound-1', to: [{ phone_number: '+16095550102', status: 'queued' }] } };
      }
    };
  };
  const outbound = await sendProviderSms('+16095550102', 'WheelsonAuto Telnyx test', { deliveryId: 'telnyx-check-outbound-1' }, transactionalSmsDependencies);
  const duplicateOutbound = await sendProviderSms('+16095550102', 'WheelsonAuto Telnyx test', { deliveryId: 'telnyx-check-outbound-1' }, transactionalSmsDependencies);
  global.fetch = originalFetch;
  assert(outbound.sent && outbound.provider === 'telnyx' && outbound.externalId === 'telnyx-outbound-1');
  assert(/^woa-sms-[a-f0-9]{64}$/.test(outbound.idempotencyKey), 'A Telnyx send must carry a deterministic WheelsonAuto delivery key.');
  assert(duplicateOutbound.sent && duplicateOutbound.duplicate && duplicateOutbound.externalId === outbound.externalId, 'A completed Telnyx delivery retry must reuse the provider result.');
  assert.strictEqual(outboundRequestCount, 1, 'A duplicate Telnyx delivery must not call the carrier twice.');
  const outboundBody = JSON.parse(outboundRequest.options.body);
  assert.strictEqual(outboundBody.webhook_url, 'https://wheelsonauto-platform.onrender.com/api/webhooks/messages?provider=telnyx');
  assert.strictEqual(outboundBody.use_profile_webhooks, true);
  assert.strictEqual(outboundBody.auto_detect, true);
  assert.strictEqual(outboundBody.encoding, 'auto');

  let ambiguousAttempts = 0;
  let ambiguousKey = '';
  const originalDateNow = Date.now;
  global.fetch = async () => {
    ambiguousAttempts += 1;
    throw new TypeError('Controlled transport interruption');
  };
  try {
    await sendProviderSms('+16095550103', 'WheelsonAuto ambiguous Telnyx test', { deliveryId: 'telnyx-check-ambiguous-1' }, transactionalSmsDependencies);
    assert.fail('The controlled Telnyx interruption should remain confirmation pending.');
  } catch (error) {
    assert(error && error.code === 'sms_confirmation_pending' && error.ambiguous === true && /^woa-sms-/.test(error.idempotencyKey || ''));
    ambiguousKey = error.idempotencyKey;
  }
  Date.now = () => originalDateNow() + 20 * 60 * 1000;
  const ambiguousDuplicate = await sendProviderSms('+16095550103', 'WheelsonAuto ambiguous Telnyx test', { deliveryId: 'telnyx-check-ambiguous-1' }, transactionalSmsDependencies);
  Date.now = originalDateNow;
  global.fetch = originalFetch;
  assert(!ambiguousDuplicate.sent && ambiguousDuplicate.inProgress && ambiguousDuplicate.duplicate, 'An ambiguous Telnyx retry must remain confirmation pending instead of sending again.');
  assert.strictEqual(ambiguousAttempts, 1, 'An ambiguous Telnyx retry must not call the carrier a second time, even after the normal processing lease expires.');

  const confirmedData = {
    messages: [{
      id: 'message-ambiguous-confirmed',
      customer: 'Confirmed Customer',
      phone: '+16095550103',
      body: 'WheelsonAuto ambiguous Telnyx test',
      provider: 'telnyx',
      providerIdempotencyKey: ambiguousKey,
      status: 'Send confirmation pending',
      tone: 'warn'
    }]
  };
  const confirmedReview = await reviewPendingSmsDelivery(confirmedData, {
    messageId: 'message-ambiguous-confirmed',
    action: 'confirm_delivered',
    note: 'Checked Telnyx message history.'
  }, { role: 'Owner', name: 'Test Owner' }, transactionalSmsDependencies);
  assert(confirmedReview.claimSettled && confirmedReview.message.deliveryReviewOutcome === 'delivered', 'Owner confirmation should settle the protected SMS claim as delivered.');
  const confirmedDuplicate = await sendProviderSms('+16095550103', 'WheelsonAuto ambiguous Telnyx test', { deliveryId: 'telnyx-check-ambiguous-1' }, transactionalSmsDependencies);
  assert(confirmedDuplicate.sent && confirmedDuplicate.duplicate && confirmedDuplicate.ownerVerified, 'A carrier-confirmed message must reuse the completed result without another provider call.');
  assert.strictEqual(ambiguousAttempts, 1, 'Owner-confirmed delivery must never call Telnyx again.');

  let releasedAttempts = 0;
  let releasedKey = '';
  global.fetch = async () => {
    releasedAttempts += 1;
    throw new TypeError('Controlled transport interruption for owner release');
  };
  try {
    await sendProviderSms('+16095550105', 'WheelsonAuto owner release test', { deliveryId: 'telnyx-check-release-1' }, transactionalSmsDependencies);
    assert.fail('The controlled owner-release interruption should remain confirmation pending.');
  } catch (error) {
    assert(error && error.code === 'sms_confirmation_pending');
    releasedKey = error.idempotencyKey;
  }
  const releasedData = {
    messages: [{
      id: 'message-ambiguous-released',
      customer: 'Released Customer',
      phone: '+16095550105',
      body: 'WheelsonAuto owner release test',
      provider: 'telnyx',
      providerIdempotencyKey: releasedKey,
      status: 'Send confirmation pending',
      tone: 'warn'
    }]
  };
  await assert.rejects(
    () => reviewPendingSmsDelivery(releasedData, { messageId: 'message-ambiguous-released', action: 'release_retry' }, { role: 'Manager', name: 'Test Manager' }, transactionalSmsDependencies),
    /Only the owner/
  );
  const releasedReview = await reviewPendingSmsDelivery(releasedData, {
    messageId: 'message-ambiguous-released',
    action: 'release_retry',
    note: 'Telnyx shows no message accepted.'
  }, { role: 'Owner', name: 'Test Owner' }, transactionalSmsDependencies);
  assert(releasedReview.claimSettled && releasedReview.message.deliveryReviewOutcome === 'retry_released', 'Owner release should settle the uncertain claim and permit a deliberate retry.');
  global.fetch = async () => {
    releasedAttempts += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: { id: 'telnyx-owner-released-retry-1', to: [{ phone_number: '+16095550105', status: 'queued' }] } };
      }
    };
  };
  const releasedRetry = await sendProviderSms('+16095550105', 'WheelsonAuto owner release test', { deliveryId: 'telnyx-check-release-1' }, transactionalSmsDependencies);
  global.fetch = originalFetch;
  assert(releasedRetry.sent && releasedRetry.externalId === 'telnyx-owner-released-retry-1', 'An owner-released SMS should allow exactly one deliberate provider retry.');
  assert.strictEqual(releasedAttempts, 2, 'Owner release should result in one interrupted attempt and one deliberate retry.');

  let rejectedAttempts = 0;
  global.fetch = async () => {
    rejectedAttempts += 1;
    if (rejectedAttempts === 1) {
      return {
        ok: false,
        status: 422,
        async json() {
          return { errors: [{ detail: 'Controlled provider rejection' }] };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: { id: 'telnyx-outbound-retry-1', to: [{ phone_number: '+16095550104', status: 'queued' }] } };
      }
    };
  };
  await assert.rejects(
    () => sendProviderSms('+16095550104', 'WheelsonAuto rejected Telnyx test', { deliveryId: 'telnyx-check-rejected-1' }, transactionalSmsDependencies),
    error => error && error.providerRejected === true && error.statusCode === 422
  );
  const rejectedRetry = await sendProviderSms('+16095550104', 'WheelsonAuto rejected Telnyx test', { deliveryId: 'telnyx-check-rejected-1' }, transactionalSmsDependencies);
  global.fetch = originalFetch;
  assert(rejectedRetry.sent && rejectedRetry.externalId === 'telnyx-outbound-retry-1', 'A definitive provider rejection must release the delivery identity for a corrected retry.');
  assert.strictEqual(rejectedAttempts, 2, 'A definitive provider rejection must allow one later provider retry.');

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
  const deliveredPublicStatus = publicMessagingStatus(messageData, { transactionalStateReady: true });
  assert.strictEqual(deliveredPublicStatus.smsDeliveryLive, true, 'A carrier-confirmed delivery should unlock the live SMS state.');
  assert.strictEqual(publicMessagingStatus(messageData).smsDeliveryLive, false, 'Carrier delivery evidence must not bypass the transactional PostgreSQL launch gate.');

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
      if (href.includes('/10dlc/campaign?brandId=brand-failed')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-failed', status: 'ACTIVE', campaignStatus: 'TCR_FAILED', usecase: 'LOW_VOLUME', failureReasons: 'Brand does not qualify for submitted campaign use-case.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder/brand/brand-failed/usecase/CUSTOMER_CARE')) return { ok: false, status: 422, async json() { return { errors: [{ detail: 'Brand does not qualify for CUSTOMER_CARE.' }] }; } };
      throw new Error('Unexpected failed readiness URL: ' + url);
    }
  });
  assert(!failedRegistration.campaignActive && failedRegistration.campaignStatus === 'Not found' && failedRegistration.historicalCampaignStatus === 'TCR_FAILED', 'A rejected campaign must remain history instead of becoming the current campaign.');
  assert.strictEqual(failedRegistration.historicalCampaignUsecase, 'LOW_VOLUME', 'The rejected campaign use case must be retained for the official qualification check.');
  assert.strictEqual(failedRegistration.intendedUsecase, 'CUSTOMER_CARE', 'WheelsonAuto should qualify the intended Customer Care replacement instead of retrying the rejected Low Volume campaign.');
  assert.strictEqual(failedRegistration.usecaseQualificationUsecase, 'CUSTOMER_CARE');
  assert(failedRegistration.registrationStage === 'campaign_qualification' && failedRegistration.resubmissionBlocked, 'A rejected brand/use-case combination must fail closed before another paid submission.');
  assert(failedRegistration.usecaseQualificationChecked && !failedRegistration.usecaseQualified, 'A Telnyx 422 qualification result must remain a failed qualification, not a generic provider error.');
  assert(/does not qualify/.test(failedRegistration.historicalFailureReason), 'Historical Telnyx failure reasons must remain available for diagnosis.');
  assert(/does not qualify/.test(failedRegistration.summary) && /Do not resubmit/.test(failedRegistration.nextAction), 'A rejected Telnyx campaign must show its carrier reason and explicitly block resubmission.');
  const replacementQualifiedRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    intendedUsecase: 'CUSTOMER_CARE',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'The requested resource or URL could not be found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [{ brandId: 'brand-replacement-qualified', identityStatus: 'VERIFIED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-replacement-qualified')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-low-volume-rejected', campaignStatus: 'TCR_FAILED', usecase: 'LOW_VOLUME', failureReasons: 'Brand does not qualify for submitted campaign use-case.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder/brand/brand-replacement-qualified/usecase/CUSTOMER_CARE')) return { ok: true, status: 200, async json() { return { usecase: 'CUSTOMER_CARE', monthlyFee: 10, quarterlyFee: 30, annualFee: 120 }; } };
      throw new Error('Unexpected replacement qualification URL: ' + url);
    }
  });
  assert(replacementQualifiedRegistration.usecaseQualified && !replacementQualifiedRegistration.resubmissionBlocked, 'A qualified Customer Care replacement should unlock campaign creation without retrying the rejected use case.');
  assert.strictEqual(replacementQualifiedRegistration.historicalCampaignUsecase, 'LOW_VOLUME');
  assert.strictEqual(replacementQualifiedRegistration.usecaseQualificationUsecase, 'CUSTOMER_CARE');
  assert(/CUSTOMER_CARE/.test(replacementQualifiedRegistration.nextAction) && /LOW_VOLUME/.test(replacementQualifiedRegistration.summary), 'The readiness result should distinguish the qualified replacement from rejected campaign history.');
  const qualifiedRegistration = await checkTelnyx10dlcReadiness({
    apiKey: 'KEY-test',
    phoneNumber: '+16095550199',
    fetchImpl: async url => {
      const href = String(url);
      if (href.includes('/10dlc/phone_number_campaigns/%2B16095550199')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'Phone number campaign assignment not found.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder?')) return { ok: false, status: 404, async json() { return { errors: [{ detail: 'The requested resource or URL could not be found.' }] }; } };
      if (href.includes('/10dlc/brand?')) return { ok: true, status: 200, async json() { return { records: [{ brandId: 'brand-qualified', identityStatus: 'VERIFIED' }] }; } };
      if (href.includes('/10dlc/campaign?brandId=brand-qualified')) return { ok: true, status: 200, async json() { return { records: [{ campaignId: 'campaign-rejected', campaignStatus: 'TCR_FAILED', usecase: 'CUSTOMER_CARE', failureReasons: 'Brand does not qualify for submitted campaign use-case.' }] }; } };
      if (href.includes('/10dlc/campaignBuilder/brand/brand-qualified/usecase/CUSTOMER_CARE')) return { ok: true, status: 200, async json() { return { usecase: 'CUSTOMER_CARE', monthlyFee: 2, quarterlyFee: 6, annualFee: 24 }; } };
      throw new Error('Unexpected qualified readiness URL: ' + url);
    }
  });
  assert(qualifiedRegistration.usecaseQualificationChecked && qualifiedRegistration.usecaseQualified && !qualifiedRegistration.resubmissionBlocked, 'A successful official qualification response may unlock corrected campaign creation.');
  assert.strictEqual(qualifiedRegistration.registrationStage, 'campaign_creation');
  assert.deepStrictEqual(qualifiedRegistration.usecaseQualificationFees, { monthly: 2, quarterly: 6, annual: 24 });
  assert(/Review the corrected campaign details/.test(qualifiedRegistration.nextAction), 'Passing qualification still requires owner review before a paid campaign submission.');
  const qualifiedCampaignDraft = telnyxCustomerCareCampaignDraft(qualifiedRegistration, { publicBaseUrl: 'https://wheelsonauto-platform.onrender.com' });
  assert.strictEqual(qualifiedCampaignDraft.payload.usecase, 'CUSTOMER_CARE');
  assert.strictEqual(qualifiedCampaignDraft.payload.brandId, 'brand-qualified');
  assert.strictEqual(qualifiedCampaignDraft.payload.autoRenewal, true);
  assert.strictEqual(qualifiedCampaignDraft.payload.subscriberOptin, true);
  assert.strictEqual(qualifiedCampaignDraft.payload.subscriberOptout, true);
  assert.strictEqual(qualifiedCampaignDraft.payload.subscriberHelp, true);
  assert.strictEqual(qualifiedCampaignDraft.payload.privacyPolicyLink, 'https://wheelsonauto-platform.onrender.com/privacy');
  assert.strictEqual(qualifiedCampaignDraft.payload.termsAndConditionsLink, 'https://wheelsonauto-platform.onrender.com/terms');
  assert(/unchecked SMS-consent box/.test(qualifiedCampaignDraft.payload.messageFlow) && /Consent source and time are stored/.test(qualifiedCampaignDraft.payload.messageFlow), 'The Customer Care draft must describe WheelsonAuto opt-in evidence rather than claim blanket consent.');
  assert(/STOP/.test(qualifiedCampaignDraft.payload.sample1) && /HELP/.test(qualifiedCampaignDraft.payload.sample3), 'Campaign samples must carry carrier opt-out and help language.');
  assert.strictEqual(qualifiedCampaignDraft.reviewFeeUsd, 15);
  assert.strictEqual(qualifiedCampaignDraft.recurringMonthlyFeeUsd, 2);
  assert.strictEqual(qualifiedCampaignDraft.confirmationPhrase, 'SUBMIT TELNYX CUSTOMER_CARE $15 + $2/MONTH');
  assert(/does not submit/.test(qualifiedCampaignDraft.warning) && /^[a-f0-9]{64}$/.test(qualifiedCampaignDraft.fingerprint), 'Campaign preparation must be a fingerprinted no-side-effect preview.');
  const campaignClaimRequest = telnyxCampaignSubmissionClaimRequest(qualifiedCampaignDraft);
  assert.deepStrictEqual(campaignClaimRequest, {
    provider: 'telnyx',
    action: '10dlc_campaign_submission',
    fingerprint: qualifiedCampaignDraft.fingerprint,
    usecase: 'CUSTOMER_CARE',
    brandId: 'brand-qualified',
    reviewFeeCents: 1500,
    recurringMonthlyFeeCents: 200
  });
  await assert.rejects(
    () => claimTelnyxCampaignSubmission({ isTransactional: () => false }, qualifiedCampaignDraft),
    error => error && error.code === 'telnyx_campaign_postgres_required',
    'A paid Telnyx campaign must fail closed before PostgreSQL is active.'
  );
  let durableCampaignClaimCall = null;
  const durableCampaignClaim = await claimTelnyxCampaignSubmission({
    isTransactional: () => true,
    async claimIdempotencyKey(scope, key, request, options) {
      durableCampaignClaimCall = { scope, key, request, options };
      return { accepted: true, claimToken: 'telnyx-campaign-claim-token' };
    }
  }, qualifiedCampaignDraft);
  assert(durableCampaignClaim.accepted && durableCampaignClaim.claimToken === 'telnyx-campaign-claim-token');
  assert.strictEqual(durableCampaignClaimCall.scope, 'telnyx_paid_campaign_submission');
  assert.strictEqual(durableCampaignClaimCall.key, qualifiedCampaignDraft.fingerprint);
  assert.deepStrictEqual(durableCampaignClaimCall.request, campaignClaimRequest);
  assert.deepStrictEqual(durableCampaignClaimCall.options, { holdClaimUntilSettled: true }, 'The paid claim must never expire into an automatic retry after an uncertain provider result.');
  const durableCampaignSettlement = telnyxCampaignSubmissionSettlement(qualifiedCampaignDraft, durableCampaignClaim, {
    status: 'submitted',
    campaignId: 'campaign-private-id',
    campaignStatus: 'TCR_PENDING',
    submittedAt: '2026-07-19T12:00:00.000Z'
  });
  assert.strictEqual(durableCampaignSettlement.action, 'complete');
  assert.strictEqual(durableCampaignSettlement.scope, 'telnyx_paid_campaign_submission');
  assert.strictEqual(durableCampaignSettlement.key, qualifiedCampaignDraft.fingerprint);
  assert.strictEqual(durableCampaignSettlement.claimToken, 'telnyx-campaign-claim-token');
  assert.strictEqual(durableCampaignSettlement.response.campaignId, 'campaign-private-id');
  const repeatedCampaignDraft = telnyxCustomerCareCampaignDraft(qualifiedRegistration, { publicBaseUrl: 'https://wheelsonauto-platform.onrender.com/' });
  assert.strictEqual(repeatedCampaignDraft.fingerprint, qualifiedCampaignDraft.fingerprint, 'Equivalent public URLs must produce the same campaign-review fingerprint.');
  assert.throws(() => telnyxCustomerCareCampaignDraft(failedRegistration, { publicBaseUrl: 'https://wheelsonauto-platform.onrender.com' }), /qualify the intended use case/, 'An unqualified campaign must fail closed before a paid submission can be prepared.');
  assert.throws(() => telnyxCustomerCareCampaignDraft({ ...qualifiedRegistration, campaignId: 'campaign-existing', campaignActive: true }, { publicBaseUrl: 'https://wheelsonauto-platform.onrender.com' }), /already exists/, 'An existing current campaign must block duplicate preparation.');
  const paidSubmissionCalls = [];
  const paidSubmissionFetch = async (url, options = {}) => {
    paidSubmissionCalls.push({ url: String(url), options });
    return { ok: true, status: 200, async json() { return { data: { campaignId: 'campaign-customer-care', campaignStatus: 'TCR_PENDING' } }; } };
  };
  await assert.rejects(() => submitTelnyxCustomerCareCampaign({
    apiKey: 'KEY-test',
    readiness: qualifiedRegistration,
    draft: qualifiedCampaignDraft,
    fingerprint: qualifiedCampaignDraft.fingerprint,
    confirmationPhrase: 'SUBMIT TELNYX',
    acknowledgedFees: true,
    fetchImpl: paidSubmissionFetch
  }), /exact fingerprint and fee phrase/, 'An inexact fee phrase must fail before the paid Telnyx endpoint is called.');
  assert.strictEqual(paidSubmissionCalls.length, 0, 'A failed Telnyx approval gate must make zero provider calls.');
  const paidSubmission = await submitTelnyxCustomerCareCampaign({
    apiKey: 'KEY-test',
    readiness: qualifiedRegistration,
    draft: qualifiedCampaignDraft,
    fingerprint: qualifiedCampaignDraft.fingerprint,
    confirmationPhrase: qualifiedCampaignDraft.confirmationPhrase,
    acknowledgedFees: true,
    fetchImpl: paidSubmissionFetch
  });
  assert.strictEqual(paidSubmission.submitted, true);
  assert.strictEqual(paidSubmission.campaignId, 'campaign-customer-care');
  assert.strictEqual(paidSubmission.campaignStatus, 'TCR_PENDING');
  assert.strictEqual(paidSubmissionCalls.length, 1, 'One approved action must make exactly one Telnyx campaign submission request.');
  assert(paidSubmissionCalls[0].url.endsWith('/10dlc/campaignBuilder') && paidSubmissionCalls[0].options.method === 'POST', 'The paid campaign action must use the official Telnyx campaign-builder endpoint.');
  assert.deepStrictEqual(JSON.parse(paidSubmissionCalls[0].options.body), qualifiedCampaignDraft.payload, 'The submitted payload must exactly match the fingerprinted preview.');
  const publicPaidSubmission = publicTelnyxCampaignSubmission({ status: 'submitted', fingerprint: paidSubmission.fingerprint, campaignId: paidSubmission.campaignId, campaignStatus: paidSubmission.campaignStatus, reviewFeeUsd: 15, recurringMonthlyFeeUsd: 2 });
  assert.strictEqual(publicPaidSubmission.campaignId, 'stored securely');
  assert.strictEqual(publicPaidSubmission.retryBlocked, true);
  assert(!JSON.stringify(publicPaidSubmission).includes('campaign-customer-care'), 'Public Telnyx submission state must not expose the provider campaign ID.');
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
