'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.WOA_MESSAGING_PROVIDER = 'telnyx';
delete process.env.WOA_OPTIONAL_CARRIER_SMS_ENABLED;
const server = require('../server');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'customer-portal.js'), 'utf8');
const staff = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const staffWorker = fs.readFileSync(path.join(root, 'staff-service-worker.js'), 'utf8');
const staffPwa = fs.readFileSync(path.join(root, 'staff-pwa.js'), 'utf8');
const staffManifest = JSON.parse(fs.readFileSync(path.join(root, 'staff-manifest.webmanifest'), 'utf8'));
const customerShell = fs.readFileSync(path.join(root, 'customer-ui', 'CustomerApp.tsx'), 'utf8');
const customerApi = fs.readFileSync(path.join(root, 'customer-ui', 'api.ts'), 'utf8');
const customerStyles = fs.readFileSync(path.join(root, 'customer-ui', 'customer-next.css'), 'utf8');
const staffShell = fs.readFileSync(path.join(root, 'staff-ui', 'StaffApp.tsx'), 'utf8');
const staffMessages = fs.readFileSync(path.join(root, 'staff-ui', 'messages', 'MessagesPage.tsx'), 'utf8');
const staffApi = fs.readFileSync(path.join(root, 'staff-ui', 'api.ts'), 'utf8');
const staffStyles = fs.readFileSync(path.join(root, 'staff-ui', 'staff-next.css'), 'utf8');

const account = {
  id: 'customer-account-1',
  name: 'Portal Customer',
  customer: 'Portal Customer',
  username: 'portal-customer',
  email: 'portal@example.com',
  phone: '8565550101',
  status: 'Active',
  passwordHash: 'test-hash',
  passwordSalt: 'test-salt',
  recurringPaymentId: 'rec-portal-1',
  vehicleId: 'vehicle-portal-1',
  organizationId: 'org-wheelsonauto'
};
const data = {
  customers: [{ id: 'customer-1', name: 'Portal Customer', email: account.email, phone: account.phone, vehicleId: account.vehicleId, vehicle: '2019 Test Car', status: 'Active' }],
  contracts: [],
  vehicles: [{ id: account.vehicleId, year: '2019', make: 'Test', model: 'Car', vin: 'TESTVIN1234567890', plate: 'TEST123', currentCustomer: 'Portal Customer', status: 'Rented' }],
  recurringPayments: [{ id: account.recurringPaymentId, customer: 'Portal Customer', vehicleId: account.vehicleId, vehicle: '2019 Test Car', vin: 'TESTVIN1234567890', licensePlate: 'TEST123', amount: 229, frequency: 'Weekly', nextRun: '2026-07-23', chargeTime: '18:00', status: 'Active' }],
  payments: [],
  maintenance: [],
  claims: [],
  documents: [],
  paymentRequests: [],
  cardSetupRequests: [],
  applications: [],
  customerAccounts: [account],
  messages: [
    { id: 'portal-inbound', customer: 'Portal Customer', customerAccountId: account.id, direction: 'Inbound', channel: 'Customer portal', body: 'Hello office', createdAt: '2026-07-21T10:00:00.000Z', status: 'Received' },
    { id: 'other-customer', customer: 'Different Customer', customerAccountId: 'different-account', direction: 'Inbound', channel: 'Customer portal', body: 'Private other message', createdAt: '2026-07-21T10:01:00.000Z', status: 'Received' }
  ],
  integrations: { clover: {}, messaging: {} }
};

const disabledCarrierStatus = server.publicMessagingStatus(data, { transactionalStateReady: true });
assert.strictEqual(disabledCarrierStatus.provider, 'wheelsonauto', 'A legacy Telnyx environment value must fall back to first-party messaging unless carrier SMS is explicitly enabled.');
assert.strictEqual(disabledCarrierStatus.configured, false, 'Disabled optional carrier SMS must not report itself as configured or live.');
assert.deepStrictEqual(server.launchRelevantJobErrors([
  { source: 'telnyx-10dlc-sync' },
  { source: 'twilio-inbound-sync' },
  { source: 'clover-auto-sync' }
]).map(row => row.source), ['clover-auto-sync'], 'Disabled optional carrier errors must leave the launch queue without hiding operational payment failures.');

const portal = server.customerPortalState(data, account);
assert.strictEqual(portal.messages.length, 1, 'Customer portal state must exclude another customer\'s conversation.');
assert.strictEqual(portal.messages[0].body, 'Hello office');
const html = server.customerPortalHtml(account, portal);
assert(html.includes('rel="manifest" href="/manifest.webmanifest"'), 'Customer portal must expose its installable manifest.');
assert(html.includes('data-customer-message-form'), 'Customer portal must render the live conversation composer.');
assert(html.includes('data-customer-message-list'), 'Customer portal must render the live message list.');
assert(html.includes('data-install-customer-app'), 'Customer portal must expose an install action when supported.');
assert(!html.includes('Private other message'), 'Rendered customer HTML must not leak another customer message.');
assert.strictEqual(staffManifest.scope, '/', 'Staff install must keep login, recovery, and every staff workspace route inside standalone mode.');
assert(staffManifest.start_url.startsWith('/login'), 'The staff app must start at secure staff login instead of the customer portal.');
assert.strictEqual(staffManifest.display, 'standalone', 'The installed staff app must not show browser address-bar chrome.');
assert(staffPwa.includes("register('/staff-service-worker.js'") && staffPwa.includes("updateViaCache: 'none'"), 'Staff pages must register the root-scoped standalone app shell and bypass stale HTTP cache when checking its worker.');
assert(staffWorker.includes("wheelsonauto-staff-shell-v10") && staffWorker.includes("fetch(event.request)") && staffWorker.includes(".catch(() => caches.match(event.request))"), 'The installed staff shell must prefer current network assets while retaining an offline fallback in the current cache generation.');
assert(worker.includes("wheelsonauto-customer-shell-v10") && worker.includes("fetch(event.request)") && worker.includes(".catch(() => caches.match(event.request))"), 'The installed customer shell must prefer current network assets while retaining an offline fallback in the current cache generation.');
assert(staffWorker.includes("'/staff-manifest.webmanifest'") && !staffWorker.includes("url.pathname.startsWith('/api/')"), 'The staff worker must cache only public shell assets and never cache private APIs.');
assert(worker.includes("key.startsWith('wheelsonauto-customer-shell-')") && staffWorker.includes("key.startsWith('wheelsonauto-staff-shell-')"), 'Customer and staff workers must clean only their own cache families.');

async function run() {
  data.messages.unshift({
    id: 'star-draft-portal',
    customer: 'Portal Customer',
    email: account.email,
    phone: account.phone,
    direction: 'AI draft',
    channel: 'Star AI',
    deliveryChannel: 'Customer portal',
    status: 'Draft ready',
    body: 'Your WheelsonAuto account message is ready.',
    aiPlan: { needsHuman: false, approvalRequired: false }
  });
  const delivered = await server.approveAiMessage(data, { draftId: 'star-draft-portal' });
  assert.strictEqual(delivered.result.sent, true, 'Approved Star replies must deliver inside the customer app without a carrier.');
  assert.strictEqual(delivered.sent.channel, 'Customer portal');
  assert.strictEqual(delivered.sent.provider, 'wheelsonauto');
  assert.strictEqual(delivered.sent.customerAccountId, account.id);
  const duplicate = await server.approveAiMessage(data, { draftId: 'star-draft-portal' });
  assert.strictEqual(duplicate.duplicate, true, 'Repeated Star approval must reuse the first in-app delivery.');
  assert.strictEqual(duplicate.result.sent, true, 'An existing in-app delivery must remain recognized as delivered.');

  assert.strictEqual(manifest.scope, '/customer');
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.start_url, '/customer#home', 'The installed customer app must open the current Home tab.');
  assert.deepStrictEqual(manifest.shortcuts.map(item => item.url), [
    '/customer#messages',
    '/customer#payments',
    '/customer#vehicle',
    '/customer#settings'
  ], 'Installed customer shortcuts must match the current five-tab account structure.');
  assert(worker.includes("url.pathname === '/customer'"), 'Service worker must explicitly exclude authenticated customer HTML from caching.');
  assert(worker.includes("url.pathname.startsWith('/api/')"), 'Service worker must never cache private API responses.');
  assert(customerApi.includes("fetch('/customer/message'") && customerApi.includes("fetch('/api/customer/portal-state'"), 'Customer replies and refreshes must use scoped first-party endpoints without a full-page reload.');
  assert(customerShell.includes("new EventSource('/api/customer/events')") && customerShell.includes("events.addEventListener('platform'"), 'Customer account updates must arrive through its authenticated live event stream.');
  assert(customerShell.includes('setBody(\'\'); onPortal(result.portal)') && customerShell.includes('Message could not be sent.'), 'Customer replies must update the open conversation from the send response and retain a clear failure state.');
  assert(customerShell.includes('customer-message-page') && customerShell.includes('customer-message-back') && customerShell.includes('settings-open'), 'Customer Messages and Settings must use focused native-app screens with Back controls.');
  const customerConversation = customerShell.slice(customerShell.indexOf('function MessagesPage('), customerShell.indexOf('function PaymentsPage('));
  assert(!/VIN|Tracker|Payment amount|Pending pickup/.test(customerConversation), 'The customer conversation must show the conversation, not repeated vehicle and payment metadata.');
  assert(customerShell.includes('function NotificationCenter(') && customerShell.includes("navigator.serviceWorker.register('/service-worker.js'"), 'Customer in-app alerts and installable app registration must remain active.');
  assert(customerStyles.includes('.customer-message-page { position: fixed') && customerStyles.includes('height: 100dvh') && customerStyles.includes('padding-bottom: 0'), 'The customer phone conversation must stay inside the visible keyboard viewport without hiding its composer behind bottom navigation.');
  assert(staffMessages.includes("new EventSource('/api/events')") && staffMessages.includes("includes('messages')"), 'The staff inbox must react to authenticated message events instead of polling the full platform.');
  assert(staffApi.includes("fetch('/api/messages/feed?limit=800'") && staffApi.includes("fetch('/api/messages/send'"), 'The staff inbox must use its lightweight feed and dedicated send endpoint.');
  assert(staffMessages.includes("availableChannels(selected)") && staffMessages.includes("channels.push('Customer portal')"), 'Staff replies must prefer the secure customer app whenever that account exists.');
  assert(staffMessages.includes("return customerAccountId ? `account:${customerAccountId}`") && staffMessages.includes("setMessages(current => current.some(message => message.id === result.message.id)") && staffMessages.includes('void refresh();'), 'Staff messages must keep one portal customer in one thread and show successful sends before the background feed refresh.');
  assert(staffMessages.includes('Star prepared a draft. Review it before sending.') && staffMessages.includes('draftStarReply(selected.latest)'), 'Star must prepare a reviewable draft instead of silently sending customer replies.');
  assert(staffMessages.includes('setSelectedKey(\'\')') && staffMessages.includes('Back to conversations'), 'Opening and closing a phone conversation must use one focused list-to-thread flow.');
  assert(!/VIN|Tracker|Payment amount|Pending pickup/.test(staffMessages), 'The open staff conversation must not repeat vehicle, tracker, payment, or pickup metadata.');
  assert(source.includes("url.pathname === '/api/messages/feed'"), 'Staff conversations need a small authenticated feed instead of repeatedly downloading the full platform state.');
  assert(source.includes('scheduleCustomerPortalMessageFollowUp(message.id)'), 'Customer message AI and owner-email follow-up must run after the inbound message is safely saved.');
  assert(source.includes("id: 'msg-ai-queued-'") && source.includes('portalQueuedStarDraftId'), 'A saved customer message must expose an immediate internal Star placeholder while the full draft is prepared.');
  assert(source.includes("record.notificationEmailStatus = 'Queued'"), 'Customer-app delivery must not wait for its optional email notification.');
  assert(staffShell.includes("new EventSource('/api/events')") && staffShell.includes('loadNotifications(controller.signal)'), 'Staff alerts must update in-app without reopening the platform.');
  assert(staffStyles.includes('env(safe-area-inset-top)') && staffStyles.includes('body:has(.next-messages.has-thread) .staff-topbar,body:has(.next-messages.has-thread) .staff-mobile-nav{display:none}') && staffStyles.includes('grid-template-rows:minmax(0,1fr);padding-top:env(safe-area-inset-top)'), 'Staff phone conversations must stay below the camera area and hide duplicate chrome while replying.');
  assert(staffStyles.includes('.next-messages{width:min(1620px,100%)') && staffStyles.includes('grid-template-columns:minmax(300px,390px) minmax(0,1fr)'), 'The staff inbox must use a balanced desktop list-and-conversation layout.');
  assert(!source.includes("providerEvidenceMissing.push('Telnyx signed SMS delivery and inbound reply proof')"), 'Optional carrier SMS must not block provider proof collection.');
  assert(!source.includes("missing.push('Telnyx signed SMS delivery and inbound reply proof')"), 'Optional carrier SMS must not block live Stripe readiness.');
  assert(source.includes('WOA_OPTIONAL_CARRIER_SMS_ENABLED') && source.includes("? 'wheelsonauto'"), 'Legacy Telnyx or Twilio environment values must not reactivate carrier SMS unless the owner explicitly enables it.');
  assert(source.includes('launchRelevantJobErrors') && source.includes("/^(?:telnyx|twilio)-/i"), 'Disabled optional carrier failures must not clutter the Stripe launch queue.');
  assert(source.includes('carrier SMS remains optional and requires WOA_OPTIONAL_CARRIER_SMS_ENABLED=1'), 'The owner launch checklist must describe carrier SMS as optional instead of a Stripe requirement.');
  console.log('First-party messaging check passed: customer-scoped conversations, Star delivery, guarded list-to-thread rendering, email-ready notices, PWA install, private caching, mobile layout, and optional SMS launch rules are wired.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
