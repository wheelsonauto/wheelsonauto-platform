const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.WOA_MESSAGING_PROVIDER = 'telnyx';
process.env.WOA_MESSAGING_FROM_NUMBER = '+16095550199';
process.env.TELNYX_API_KEY = 'KEY-consent-test';
process.env.WOA_MESSAGING_ENABLED = '1';
const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'woa-messaging-consent-'));
const isolatedState = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed.json'), 'utf8'));
isolatedState.messages = [];
isolatedState.integrations = isolatedState.integrations || {};
isolatedState.integrations.messaging = { ...(isolatedState.integrations.messaging || {}), aiEnabled: false, aiAutoSend: false };
fs.writeFileSync(path.join(isolatedDataDir, 'data.json'), JSON.stringify(isolatedState));
process.env.DATA_DIR = isolatedDataDir;

const consent = require('../messaging-consent');
const { sendProviderSms, processMessagingWebhookEvent } = require('../server');

(async () => {
  const data = {
    customers: [{ id: 'customer-1', name: 'Consent Test', phone: '(609) 555-0102', organizationId: 'org-wheelsonauto' }],
    recurringPayments: [{ id: 'recurring-1', customer: 'Consent Test', phone: '6095550102', organizationId: 'org-wheelsonauto' }]
  };

  assert.deepStrictEqual(consent.classifyInboundKeyword('STOP.'), { action: 'opt_out', keyword: 'STOP' });
  assert.deepStrictEqual(consent.classifyInboundKeyword('start'), { action: 'opt_in', keyword: 'START' });
  assert.strictEqual(consent.classifyInboundKeyword('Can I pick up Friday?'), null);

  const unknown = consent.outboundPermission(data, { phone: '+16095550102', organizationId: 'org-wheelsonauto' });
  assert.strictEqual(unknown.allowed, false);
  assert.strictEqual(unknown.status, consent.STATUS.UNKNOWN);

  const first = consent.recordConsent(data, {
    phone: '+16095550102',
    customer: 'Consent Test',
    customerId: 'customer-1',
    organizationId: 'org-wheelsonauto',
    status: consent.STATUS.OPTED_IN,
    source: 'website_application_checkbox',
    eventId: 'application-event-1',
    recordedBy: 'Customer',
    ip: '203.0.113.10',
    userAgent: 'WheelsonAuto consent test'
  }, { now: '2026-07-18T12:00:00.000Z' });
  assert(first.changed);
  assert.strictEqual(data.messagingConsents.length, 1);
  assert.strictEqual(data.messagingConsentEvents.length, 1);
  assert.strictEqual(data.customers[0].smsConsentStatus, consent.STATUS.OPTED_IN);
  assert.strictEqual(data.recurringPayments[0].smsConsentStatus, consent.STATUS.OPTED_IN);
  assert.strictEqual(consent.outboundPermission(data, { phone: '6095550102', organizationId: 'org-wheelsonauto' }).allowed, true);

  const duplicate = consent.recordConsent(data, {
    phone: '6095550102',
    status: consent.STATUS.OPTED_IN,
    organizationId: 'org-wheelsonauto',
    eventId: 'application-event-1'
  });
  assert(duplicate.duplicate);
  assert.strictEqual(data.messagingConsentEvents.length, 1, 'Provider webhook retries must not duplicate consent evidence.');

  const stopped = consent.recordConsent(data, {
    phone: '6095550102',
    customer: 'Consent Test',
    organizationId: 'org-wheelsonauto',
    status: consent.STATUS.OPTED_OUT,
    source: 'inbound_keyword',
    keyword: 'STOP',
    eventId: 'telnyx-stop-1'
  }, { now: '2026-07-18T13:00:00.000Z' });
  assert(stopped.changed);
  const blocked = consent.outboundPermission(data, { phone: '6095550102', organizationId: 'org-wheelsonauto' });
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.status, consent.STATUS.OPTED_OUT);
  assert.match(blocked.reason, /text START/i);

  const providerBlocked = await sendProviderSms('+16095550102', 'This must remain a draft.', {
    customer: 'Consent Test',
    customerId: 'customer-1',
    organizationId: 'org-wheelsonauto',
    customerMessage: true,
    consentData: data,
    messagingSettings: { enabled: true }
  });
  assert.strictEqual(providerBlocked.sent, false);
  assert.strictEqual(providerBlocked.status, 'Opted out');

  consent.recordConsent(data, {
    phone: '6095550102',
    customer: 'Consent Test',
    organizationId: 'org-wheelsonauto',
    status: consent.STATUS.OPTED_IN,
    source: 'inbound_keyword',
    keyword: 'START',
    eventId: 'telnyx-start-1'
  }, { now: '2026-07-18T14:00:00.000Z' });

  let providerRequest = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    providerRequest = { url: String(url), options };
    return { ok: true, async json() { return { data: { id: 'message-consent-1', to: [{ status: 'queued' }] } }; } };
  };
  const providerAllowed = await sendProviderSms('+16095550102', 'Customer-care reply.', {
    customer: 'Consent Test',
    customerId: 'customer-1',
    organizationId: 'org-wheelsonauto',
    customerMessage: true,
    consentData: data,
    messagingSettings: { enabled: true }
  });
  global.fetch = originalFetch;
  assert(providerAllowed.sent);
  assert.strictEqual(providerAllowed.externalId, 'message-consent-1');
  assert(providerRequest && providerRequest.url === 'https://api.telnyx.com/v2/messages');

  const stopPayload = {
    data: {
      event_type: 'message.received',
      payload: {
        id: 'telnyx-live-stop-1',
        from: { phone_number: '+16095550155' },
        to: [{ phone_number: '+16095550199' }],
        text: 'STOP'
      }
    }
  };
  const stoppedWebhook = await processMessagingWebhookEvent('telnyx', {}, stopPayload);
  assert.strictEqual(stoppedWebhook.smsConsent.status, consent.STATUS.OPTED_OUT);
  assert.strictEqual(stoppedWebhook.smsConsent.command, 'opt_out');
  let webhookState = JSON.parse(fs.readFileSync(path.join(isolatedDataDir, 'data.json'), 'utf8'));
  assert.strictEqual(consent.currentConsent(webhookState, { phone: '+16095550155', organizationId: 'org-wheelsonauto' }).status, consent.STATUS.OPTED_OUT);
  assert(webhookState.messages.some(message => message.externalId === 'telnyx-live-stop-1' && message.status === 'Opted out'));
  const stopEventCount = webhookState.messagingConsentEvents.length;
  const duplicateStop = await processMessagingWebhookEvent('telnyx', {}, stopPayload);
  assert(duplicateStop.duplicate);
  webhookState = JSON.parse(fs.readFileSync(path.join(isolatedDataDir, 'data.json'), 'utf8'));
  assert.strictEqual(webhookState.messagingConsentEvents.length, stopEventCount, 'A duplicate inbound webhook must not duplicate opt-out evidence.');

  const startPayload = {
    data: {
      event_type: 'message.received',
      payload: {
        id: 'telnyx-live-start-1',
        from: { phone_number: '+16095550155' },
        to: [{ phone_number: '+16095550199' }],
        text: 'START'
      }
    }
  };
  const startedWebhook = await processMessagingWebhookEvent('telnyx', {}, startPayload);
  assert.strictEqual(startedWebhook.smsConsent.status, consent.STATUS.OPTED_IN);
  webhookState = JSON.parse(fs.readFileSync(path.join(isolatedDataDir, 'data.json'), 'utf8'));
  assert.strictEqual(consent.currentConsent(webhookState, { phone: '+16095550155', organizationId: 'org-wheelsonauto' }).status, consent.STATUS.OPTED_IN);

  const root = path.join(__dirname, '..');
  const nativeSite = fs.readFileSync(path.join(root, 'native-site.js'), 'utf8');
  const nativeClient = fs.readFileSync(path.join(root, 'native-site-client.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert(nativeSite.includes('name="smsConsent"'), 'The public application must expose a separate optional SMS consent control.');
  assert(nativeSite.includes('Consent is not a condition of purchase'));
  assert(nativeSite.includes('Reply STOP to opt out or HELP for help'));
  assert(nativeClient.includes('payload.smsConsent = !!payload.smsConsent'));
  assert(server.includes('Mobile information will not be sold or shared with third parties for promotional or marketing purposes.'));
  assert(server.includes('SMS consent is not shared with third parties or affiliates for marketing.'));
  assert(server.includes("source: 'customer_initiated_inbound'"));
  assert(server.includes("source: 'inbound_keyword'"));
  assert(app.includes('if(!recordCustomerFileSmsConsent(fc))return'), 'The authoritative customer-file save handler must persist the selected SMS permission.');

  fs.rmSync(isolatedDataDir, { recursive: true, force: true });

  console.log('Messaging consent check passed: public opt-in evidence, STOP/START history, provider enforcement, and carrier policy language are wired.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
