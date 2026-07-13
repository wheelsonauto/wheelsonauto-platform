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
  verifyTelnyxWebhook,
  parseIncomingMessage,
  sendProviderSms,
  applyTelnyxDeliveryEvent,
  configureTelnyxMessagingProfile
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

  console.log('Telnyx messaging check passed: signed inbound webhooks, message parsing, delivery receipts, and profile setup are wired.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
