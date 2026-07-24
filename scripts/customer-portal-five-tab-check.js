const fs = require('node:fs');
const path = require('node:path');

process.env.WOA_DISABLE_BACKGROUND_JOBS = '1';
process.env.WOA_SESSION_SECRET = process.env.WOA_SESSION_SECRET || 'customer-portal-five-tab-test-secret';
process.env.WOA_ADMIN_USERNAME = process.env.WOA_ADMIN_USERNAME || 'portal-test-owner';
process.env.WOA_ADMIN_PASSWORD = process.env.WOA_ADMIN_PASSWORD || 'PortalTestOwnerPassword42!';

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'customer-portal.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const { customerPortalHtml, recordHostedCheckoutPayment } = require('../server.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function occurrences(source, pattern) {
  return (String(source || '').match(pattern) || []).length;
}

const account = {
  id: 'account-portal-test',
  name: 'Portal Test Customer',
  customer: 'Portal Test Customer',
  phone: '8565550199',
  email: 'portal-test@example.com',
  username: 'portal-test@example.com'
};
const portalState = {
  summary: { customer: account.name, vehicle: '2019 Mitsubishi Mirage', vin: 'ML32A3HJ9KH000001', tag: 'TST19' },
  recurring: { id: 'rec-portal-test', amount: 229, frequency: 'Weekly', nextRun: '2026-07-30', status: 'Active', customerPortalCreditBalance: 50, paymentProvider: 'stripe', cardLabel: 'Visa ending 4242' },
  vehicle: { id: 'veh-portal-test', year: '2019', make: 'Mitsubishi', model: 'Mirage', vin: 'ML32A3HJ9KH000001', plate: 'TST19', mileage: 48220, status: 'Rented' },
  payments: [{ id: 'pay-portal-test', amount: 179, status: 'Paid', paymentType: 'Weekly payment', createdAt: '2026-07-23T12:00:00.000Z' }],
  maintenance: [{ id: 'service-portal-test', type: 'Monthly inspection', status: 'Due', nextDue: '2026-08-01' }],
  claims: [{ id: 'claim-portal-test', type: 'Toll', status: 'Open', amount: 14.75, incidentDate: '2026-07-20' }],
  messages: [{ id: 'message-portal-test', direction: 'Outbound', body: 'Your account is ready.', status: 'Sent', createdAt: '2026-07-23T12:30:00.000Z' }],
  applications: [{ id: 'application-portal-test', vehicle: '2019 Mitsubishi Mirage', status: 'Approved', updatedAt: '2026-07-23T11:00:00.000Z' }],
  onboardingSessions: [],
  documents: [{ id: 'document-portal-test', type: 'Insurance proof', status: 'Verified', createdAt: '2026-07-22T10:00:00.000Z' }],
  paymentRequests: [],
  cardSetupRequests: [],
  availableVehicles: [{ id: 'online-portal-test', slug: '2018-nissan-versa-online-portal-test', title: '2018 Nissan Versa', weeklyPayment: 229, downPayment: 700, availability: 'Available' }]
};

const html = customerPortalHtml(account, portalState);
const finalRendererStart = serverSource.indexOf('function customerPortalFiveTabHtml(');
const finalRendererEnd = serverSource.indexOf('customerPortalHtml = customerPortalFiveTabHtml;', finalRendererStart);
const finalRenderer = serverSource.slice(finalRendererStart, finalRendererEnd);
const expectedTabs = ['home', 'messages', 'payments', 'vehicle', 'settings'];

assert(finalRendererStart >= 0 && finalRendererEnd > finalRendererStart, 'The final five-tab customer renderer must remain the active portal source.');
assert(occurrences(html, /data-portal-page/g) === 5, 'The customer app must render exactly five workspaces.');
assert(occurrences(html, /class="customer-action-hub customer-app-tabs"/g) === 1, 'The customer app must expose one compact primary navigation bar.');
expectedTabs.forEach(tab => {
  assert(html.includes('href="#portal-' + tab + '"'), 'Missing ' + tab + ' customer tab.');
  assert(html.includes('id="portal-' + tab + '"'), 'Missing ' + tab + ' customer workspace.');
  assert(clientSource.includes("'#portal-" + tab + "'"), 'Customer navigation does not recognize ' + tab + '.');
});
['overview', 'card', 'service', 'documents', 'issues', 'applications'].forEach(tab => {
  assert(!finalRenderer.includes('href="#portal-' + tab + '"'), 'Legacy duplicate tab remains in the final customer renderer: ' + tab);
});

[
  '/customer/message',
  '/customer/account-payment',
  '/customer/payment-date-change',
  '/customer/service-request',
  '/customer/issue-report',
  '/customer/swap-request',
  '/customer/profile',
  '/customer/feedback',
  '/customer/document-update'
].forEach(route => assert(html.includes('action="' + route + '"'), 'Customer workspace is missing its connected action: ' + route));
assert(serverSource.includes('action="/customer/card-change"') && (html.includes('/customer/card-change') || html.includes('Card update needs office help')), 'Card changes must either open the connected secure flow or state honestly why provider setup is required.');
assert(html.includes('weekly payment divided by seven'), 'The payment date-change fee rule must be visible before submission.');
assert(html.includes('starts a new 19-month term'), 'The vehicle swap must disclose and require the term reset.');
assert(html.includes('This does not reassign a vehicle.'), 'A swap request must not silently mutate the fleet assignment.');
assert(html.includes('Current password'), 'Sensitive profile edits must require the current password.');
assert(html.includes('JPG, PNG, or PDF up to 5 MB'), 'Private document upload limits must be visible.');
assert(clientSource.includes('weekly / 7 * days'), 'The live date-change preview must use the exact weekly divided-by-seven calculation.');
assert(clientSource.includes("window.addEventListener('hashchange'"), 'Browser back and customer tab changes must stay synchronized.');
assert(styleSource.includes('.customer-app-pages') && styleSource.includes('.customer-app-tabs'), 'The responsive customer app layout styles are missing.');
assert(/@media\s*\(max-width:\s*760px\)/.test(styleSource), 'The customer app must retain a phone-specific layout.');
assert(/font-size:\s*16px/.test(styleSource), 'Phone form controls must retain a 16px size to prevent input zoom.');

[
  "row.customerAccountId === account.id",
  "row.appliesToRecurringPaymentId === recurring.id",
  "row.paymentAllocation === allocation",
  "row.paymentDateChangeOriginal === originalDate",
  "row.paymentDateChangeTarget === targetDate",
  "row.customerAccountId === account.id && row.requestedOnlineVehicleId === selected.id",
  "verifyPasswordRecord(currentPassword, account)",
  "profileIdentifiers",
  "profileConflictsWith",
  "Changes apply only to this signed-in account"
].forEach(text => assert(serverSource.includes(text), 'Exact-account or duplicate-write guard is missing: ' + text));

const creditState = {
  recurringPayments: [{ id: 'rec-credit-test', amount: 229, frequency: 'Weekly', nextRun: '2026-07-30', customerPortalCreditBalance: 10 }],
  payments: [],
  documents: []
};
const creditRequest = {
  id: 'request-credit-test',
  customerAccountId: 'account-credit-test',
  appliesToRecurringPaymentId: 'rec-credit-test',
  paymentAllocation: 'pay_ahead',
  paymentProvider: 'stripe',
  amount: 25,
  customer: 'Portal Credit Test',
  paymentType: 'Advance weekly payment'
};
recordHostedCheckoutPayment(creditState, creditRequest, { provider: 'stripe', providerPaymentId: 'pi_credit_test', stripePaymentIntentId: 'pi_credit_test', paidAt: '2026-07-23T14:00:00.000Z' });
recordHostedCheckoutPayment(creditState, creditRequest, { provider: 'stripe', providerPaymentId: 'pi_credit_test', stripePaymentIntentId: 'pi_credit_test', paidAt: '2026-07-23T14:00:00.000Z' });
assert(creditState.recurringPayments[0].customerPortalCreditBalance === 35, 'Duplicate payment webhooks must add customer account credit only once.');
assert(creditState.payments.length === 1, 'Duplicate payment webhooks must create one payment record.');
assert(creditState.payments[0].customerAccountId === 'account-credit-test' && creditState.payments[0].appliesToRecurringPaymentId === 'rec-credit-test', 'Portal payment proof must retain exact account and recurring links.');

const dateState = {
  recurringPayments: [{ id: 'rec-date-test', amount: 229, frequency: 'Weekly', nextRun: '2026-07-30', adminNextRun: '2026-07-30' }],
  payments: [],
  documents: []
};
const dateRequest = {
  id: 'request-date-test',
  customerAccountId: 'account-date-test',
  appliesToRecurringPaymentId: 'rec-date-test',
  paymentProvider: 'stripe',
  amount: 98.14,
  paymentType: 'Payment date change fee',
  paymentDateChangeOriginal: '2026-07-30',
  paymentDateChangeTarget: '2026-08-02',
  paymentDateChangeDays: 3,
  customer: 'Portal Date Test'
};
recordHostedCheckoutPayment(dateState, dateRequest, { provider: 'stripe', providerPaymentId: 'pi_date_test', stripePaymentIntentId: 'pi_date_test', paidAt: '2026-07-23T15:00:00.000Z' });
recordHostedCheckoutPayment(dateState, dateRequest, { provider: 'stripe', providerPaymentId: 'pi_date_test', stripePaymentIntentId: 'pi_date_test', paidAt: '2026-07-23T15:00:00.000Z' });
assert(dateState.recurringPayments[0].nextRun === '2026-08-02' && dateState.recurringPayments[0].adminNextRun === '2026-08-02', 'A verified date-change fee must update the exact recurring schedule once.');
assert(dateState.payments.length === 1 && dateState.payments[0].paymentDateChangeApplied === true, 'Date-change proof must remain idempotent and auditable.');

console.log('Customer portal five-tab check passed.');
