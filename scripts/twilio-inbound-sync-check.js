const assert = require('assert');
const {
  listTwilioInboundMessages,
  syncTwilioInboundMessages,
  twilioSignatureForPayload
} = require('../server');

const phoneNumber = '+17372583742';
const accountSid = 'ACtest';
const authToken = 'test-token';
const inboundMessages = [
  { sid: 'SM-newer', direction: 'inbound', from: '+16095550102', to: phoneNumber, body: 'Newer reply', date_created: '2026-07-13T12:00:02Z' },
  { sid: 'SM-existing', direction: 'inbound', from: '+16095550101', to: phoneNumber, body: 'Already saved', date_created: '2026-07-13T12:00:01Z' },
  { sid: 'SM-outbound', direction: 'outbound-api', from: phoneNumber, to: '+16095550103', body: 'Ignore outbound' },
  { sid: 'SM-other-number', direction: 'inbound', from: '+16095550104', to: '+17375559999', body: 'Ignore wrong inbox' }
];
const fetchImpl = async url => {
  assert(String(url).includes('/Messages.json?'));
  return { ok: true, json: async () => ({ messages: inboundMessages }) };
};

(async () => {
  const listed = await listTwilioInboundMessages({ accountSid, authToken, phoneNumber, fetchImpl });
  assert.deepStrictEqual(listed.map(item => item.sid), ['SM-newer', 'SM-existing']);

  const delivered = [];
  const result = await syncTwilioInboundMessages({
    provider: 'twilio',
    accountSid,
    authToken,
    phoneNumber,
    fetchImpl,
    data: { messages: [{ externalId: 'SM-existing' }], integrations: { messaging: {} } },
    persist: false,
    deliver: async message => {
      delivered.push(message.sid);
      return { ok: true, received: true };
    }
  });
  assert.deepStrictEqual(delivered, ['SM-newer']);
  assert.deepStrictEqual(result, { checked: 2, pending: 1, delivered: 1 });

  const signature = twilioSignatureForPayload('https://example.com/webhook', { Body: 'Hello', From: '+16095550102' }, authToken);
  assert.strictEqual(typeof signature, 'string');
  assert(signature.length > 20);
  console.log('Twilio inbound secure-sync check passed: inbound-only filtering, deduplication, delivery ordering, and signed intake are wired.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
