'use strict';

process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4188';
process.env.WOA_AUTO_SYNC_MS = '3600000';
process.env.WOA_AUTOPAY_MS = '3600000';
process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
process.env.WOA_EMAIL_ENABLED = '0';
process.env.WOA_MESSAGING_ENABLED = '0';

const {
  crossOriginSessionWrite,
  assertRecurringChargeAllowed,
  saveFailedChargeResult,
  applySuccessfulPaymentToCustomerDues
} = require('../server.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const recurring = {
  id: 'rec-manual-control',
  customer: 'Payment Control Customer',
  customerAccountId: 'acct-payment-control',
  paymentProvider: 'stripe',
  provider: 'Stripe',
  stripeCustomerId: 'cus_payment_control',
  stripePaymentMethodId: 'pm_payment_control',
  cloverCustomerId: 'clover-customer-control',
  cloverSubscriptionId: 'clover-plan-control',
  stripeMigration: { state: 'stripe_card_saved' },
  nextRun: '2026-08-20',
  frequency: 'Weekly',
  amount: 75,
  status: '2x failed - contact customer',
  retryCount: 2,
  failedAttempts: 2
};
const data = {
  recurringPayments: [recurring],
  payments: [],
  claims: [],
  vehicles: [],
  integrations: { clover: { recurringPlanMembers: [] } }
};

const scheduledStripeGuard = assertRecurringChargeAllowed(data, recurring, { automatic: false }, 'stripe');
assert(scheduledStripeGuard.additionalManualCharge === false, 'The selected Stripe provider must remain active even when historical Clover identifiers are present.');

let cloverAutomaticBlocked = false;
try {
  assertRecurringChargeAllowed(data, recurring, { automatic: true }, 'clover');
} catch (error) {
  cloverAutomaticBlocked = error && error.code === 'clover_automatic_charging_disabled';
}
assert(cloverAutomaticBlocked, 'Automatic Clover charging must remain disabled after Stripe becomes the selected provider.');

const manualGuard = assertRecurringChargeAllowed(data, recurring, {
  automatic: false,
  allowAdditionalManualCharge: true,
  chargePurpose: 'one_time'
}, 'stripe');
assert(manualGuard.additionalManualCharge === true && manualGuard.scheduledDueKey === '', 'A one-time owner charge must not consume or advance a recurring billing period.');

const failed = saveFailedChargeResult(data, recurring, {
  amount: 40,
  chargePurpose: 'one_time',
  reason: 'Owner-requested test'
}, new Error('Declined'), {
  createsDue: false,
  preserveRecurringState: true,
  method: 'Stripe saved card',
  paymentProvider: 'stripe'
});
assert(failed.status === 'Manual charge failed' && failed.createsDue === false && failed.balanceRemaining === 0, 'A failed manual charge must be recorded without creating customer dues.');
assert(recurring.status === '2x failed - contact customer' && recurring.retryCount === 2, 'A failed manual charge must not rewrite the scheduled autopay retry state.');

data.claims.push({ id: 'claim-control', customer: recurring.customer, customerAccountId: recurring.customerAccountId, type: 'Toll', amount: 20, status: 'Open', createdAt: '2026-08-01T12:00:00.000Z' });
data.payments.push({ id: 'failed-auto-control', customer: recurring.customer, customerAccountId: recurring.customerAccountId, amount: 15, status: '2x failed - contact customer', createsDue: true, createdAt: '2026-08-02T12:00:00.000Z' });
const duesPayment = { id: 'paid-dues-control', customer: recurring.customer, amount: 25, status: 'Paid', chargePurpose: 'dues' };
data.payments.unshift(duesPayment);
applySuccessfulPaymentToCustomerDues(data, recurring, duesPayment, 25);
assert(data.claims[0].remainingAmount === 0 && data.claims[0].status === 'Paid', 'A dues payment must close the oldest open claim first.');
assert(data.payments.find(row => row.id === 'failed-auto-control').balanceRemaining === 10, 'The remainder of a dues payment must reduce the unpaid automatic payment balance.');
assert(duesPayment.dueAppliedAmount === 25 && duesPayment.dueRemainingAmount === 0, 'The successful payment must retain exact allocation evidence.');
applySuccessfulPaymentToCustomerDues(data, recurring, duesPayment, 25);
assert(data.payments.find(row => row.id === 'failed-auto-control').balanceRemaining === 10, 'Replaying the same successful payment must not allocate it twice.');

const finalDuesPayment = { id: 'paid-dues-final', customer: recurring.customer, amount: 10, status: 'Paid', chargePurpose: 'dues' };
data.payments.unshift(finalDuesPayment);
applySuccessfulPaymentToCustomerDues(data, recurring, finalDuesPayment, 10);
assert(data.payments.find(row => row.id === 'failed-auto-control').balanceRemaining === 0, 'Paying the remaining dues must clear the unpaid transaction balance.');
assert(recurring.status === 'Active' && recurring.retryCount === 0 && recurring.failedAttempts === 0, 'A fully paid overdue schedule must leave the customer active instead of failed.');

const staleCookieRequest = {
  method: 'POST',
  headers: { cookie: 'woa_session=stale-session', origin: 'https://wheelsonauto-platform.onrender.com' }
};
assert(crossOriginSessionWrite(staleCookieRequest, '/api/public/card-setup/setup-token/stripe-checkout') === false, 'A single-use public card setup route must not be blocked by an unrelated stale app cookie.');
assert(crossOriginSessionWrite(staleCookieRequest, '/api/customers/customer-1') === true, 'Cookie-authenticated account writes must remain protected from cross-origin requests.');

console.log('Customer payment control check passed: selected Stripe billing stays active, automatic Clover stays disabled, one-time charge failures create no dues, due payments allocate once, and public card setup remains session-independent.');
