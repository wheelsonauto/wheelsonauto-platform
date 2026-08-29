'use strict';

const assert = require('node:assert');
const server = require('../server');

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());
const shiftDay = days => {
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const dashboardData = {
  recurringPayments: [
    { id: 'due-today', customer: 'Due Today', vehicle: '2018 Pending Car', amount: 225, nextRun: today, status: 'Active', paymentProvider: 'stripe', cardLast4: '1111' },
    { id: 'failed-twice', customer: 'Call Now', vehicle: '2019 Failed Car', amount: 250, nextRun: today, status: 'Failed - contact', failedAttempts: 2, paymentProvider: 'stripe', cardLast4: '2222' },
    { id: 'failed-once', customer: 'Retry Customer', vehicle: '2020 Retry Car', amount: 210, nextRun: today, status: '1x failed - retrying', failedAttempts: 1, paymentProvider: 'stripe', cardLast4: '3333' },
    { id: 'already-paid', customer: 'Already Paid', vehicle: '2021 Paid Car', amount: 200, nextRun: today, status: 'Active', lastAutoChargeDate: today, paymentProvider: 'stripe', cardLast4: '4242' },
    { id: 'past-due', customer: 'Oldest Balance', vehicle: '2017 Balance Car', amount: 275, nextRun: shiftDay(-10), status: 'Past due', paymentProvider: 'stripe', cardLast4: '5555' }
  ],
  payments: [
    { id: 'paid-today', recurringPaymentId: 'already-paid', customer: 'Already Paid', vehicle: '2021 Paid Car', cardLast4: '4242', amount: 200, status: 'Paid', createdAt: `${today}T14:35:00.000Z` },
    { id: 'old-payment', recurringPaymentId: 'due-today', customer: 'Due Today', vehicle: '2018 Pending Car', cardLast4: '1111', amount: 225, status: 'Paid', createdAt: `${shiftDay(-20)}T15:10:00.000Z` },
    { id: 'legacy-incomplete', recurringPaymentId: 'already-paid', customer: 'Already Paid', amount: 200, status: 'Paid', createdAt: `${shiftDay(-40)}T15:10:00.000Z` }
  ],
  maintenance: [
    { id: 'scheduled', customer: 'Scheduled Customer', status: 'Appointment scheduled', due: today },
    { id: 'complete', customer: 'Complete Customer', status: 'Completed', due: today },
    { id: 'needed', customer: 'Service Customer', status: 'Service needed', due: today },
    { id: 'urgent', customer: 'Urgent Customer', status: 'Urgent - staff contact now', due: today },
    { id: 'late-inspection', customer: 'Inspection Customer', vehicle: '2018 Test Car', type: 'Monthly inspection', status: 'Due', due: shiftDay(-15) },
    { id: 'overdue-service', customer: 'Repair Customer', vehicle: '2022 Repair Car', issue: 'Brake repair', status: 'Service needed', due: shiftDay(-6) },
    { id: 'ancient-bad-date', customer: 'Bad Date', vehicle: '2001 Bad Date Car', issue: 'Oil change', status: 'Due', due: '2001-01-01' },
    { id: 'completed-service', vehicle: '2019 Test Car', issue: 'Oil change', status: 'Completed', completedAt: today }
  ],
  claims: [{ id: 'late-toll', customer: 'Toll Customer', type: 'E-ZPass toll', amount: 18.25, status: 'Open', due: shiftDay(-3) }],
  pickupAppointments: [{ id: 'pickup-today', customer: 'Pickup Customer', vehicle: '2020 Test Car', requestedPickupDate: today, requestedPickupTime: '1:00 PM', status: 'Confirmed' }],
  tasks: [
    { id: 'return-today', customer: 'Return Customer', vehicle: '2021 Test Car', type: 'Vehicle return', due: today, returnMethod: 'Customer drop-off', status: 'Scheduled' },
    { id: 'done-task', title: 'Called customer', status: 'Done', doneAt: today }
  ],
  integrations: { clover: { recurringPlanMembers: [] } }
};

const feed = server.dashboardPriorityFeed(dashboardData, today);
assert.deepStrictEqual(feed.todayDue.map(row => row.id), ['due-today']);
assert.deepStrictEqual(feed.failedTwice.map(row => row.id), ['failed-twice']);
assert.deepStrictEqual(feed.failedOnce.map(row => row.id), ['failed-once']);
assert.deepStrictEqual(feed.serviceNeeded.map(row => row.id).sort(), ['ancient-bad-date', 'needed', 'overdue-service', 'urgent']);
assert.deepStrictEqual(feed.overdueDues.map(row => row.id), ['late-toll']);
assert.deepStrictEqual(feed.inspections.map(row => row.id), ['late-inspection']);
assert.deepStrictEqual(feed.pickups.map(row => row.id), ['pickup-today']);
assert.deepStrictEqual(feed.returns.map(row => row.id), ['return-today']);
assert(feed.completedToday.some(row => row.id === 'done-task') && feed.completedToday.some(row => row.id === 'completed-service'));
assert.strictEqual(feed.summary.collectedAmount, 200);
assert.deepStrictEqual(feed.todayCustomers.map(row => row.status), ['Failed twice', 'Failed once', 'Pending', 'Paid']);
assert.strictEqual(feed.todayCustomers.find(row => row.id === 'already-paid').cardLast4, '4242');
assert.strictEqual(feed.transactions[0].vehicle, '2021 Paid Car');
assert.strictEqual(feed.transactions[0].cardLast4, '4242');
assert(feed.transactions.some(row => row.id === 'old-payment'), 'Historical transactions must remain searchable beyond today.');
assert.strictEqual(feed.transactions.find(row => row.id === 'legacy-incomplete').vehicle, '', 'Historical evidence must never borrow a customer’s current vehicle.');
assert.strictEqual(feed.transactions.find(row => row.id === 'legacy-incomplete').cardLast4, '', 'Historical evidence must never borrow a customer’s current card.');
assert(feed.maintenanceAppointments.some(row => row.id === 'scheduled'), 'Today’s scheduled service must appear in appointments.');
assert(feed.overdueService.some(row => row.id === 'overdue-service') && feed.overdueService.some(row => row.id === 'late-inspection'), 'Prior-day incomplete service and inspections must appear as overdue.');
assert(!feed.overdueService.some(row => row.id === 'ancient-bad-date' || row.id === 'completed-service'), 'Completed or implausibly stale service rows must not pollute the dashboard.');
assert.strictEqual(feed.overdueBalances[0].id, 'late-toll', 'The dues panel must contain tolls, violations, tickets, fees, and other non-recurring balances only.');
assert(!feed.overdueBalances.some(row => row.id === 'past-due'), 'Recurring weekly balances belong in Today billing, not the tolls and dues panel.');
assert(feed.overdueBalances.some(row => row.id === 'late-toll' && /toll/i.test(row.reason)), 'Tolls and violations must appear in customer past-due balances.');

const serviceData = { maintenance: [] };
const servicePlan = server.prepareStarServiceAppointment(serviceData, {
  actionType: 'maintenance_schedule',
  customer: 'Service Customer',
  related: {},
  reply: 'I can help with that.'
}, {
  customerName: 'Service Customer',
  organizationId: 'org-wheelsonauto',
  vehicleName: '2018 Test Car'
}, {
  messageId: 'service-message-1',
  body: 'My tire is making a noise. Please schedule service today.'
});
assert.strictEqual(serviceData.maintenance.length, 1);
assert.notStrictEqual(serviceData.maintenance[0].due, today, 'Nonurgent service must not book same-day.');
assert.strictEqual(serviceData.maintenance[0].status, 'Appointment scheduled');
assert.strictEqual(servicePlan.related.maintenanceId, serviceData.maintenance[0].id);

const recurring = {
  id: 'stripe-plan-1',
  customer: 'Card Customer',
  paymentProvider: 'stripe',
  provider: 'Stripe',
  stripeCustomerId: 'cus_old',
  stripePaymentMethodId: 'pm_old',
  stripeCardSavedAt: '2026-08-01T12:00:00.000Z',
  cardSetupRequestId: 'setup-old',
  stripeCardAuthenticationSetupNeeded: true,
  stripeChargeAttempt: { status: 'authentication_required' }
};
const cardData = {
  recurringPayments: [recurring],
  cardSetupRequests: [{
    id: 'setup-new',
    recurringPaymentId: recurring.id,
    customer: recurring.customer,
    paymentProvider: 'stripe',
    status: 'Stripe card saved - owner switch required',
    completedAt: '2026-08-20T12:00:00.000Z',
    stripeCustomerId: 'cus_new',
    stripePaymentMethodId: 'pm_new',
    stripeCardBrand: 'visa',
    stripeCardLast4: '4242',
    stripeLivemode: true
  }],
  integrations: { clover: { recurringPlanMembers: [] } }
};
const refreshed = server.refreshLatestStripeCardBinding(cardData, recurring);
assert.strictEqual(refreshed.stripeCustomerId, 'cus_new');
assert.strictEqual(refreshed.stripePaymentMethodId, 'pm_new');
assert.strictEqual(refreshed.cardLast4, '4242');
assert.strictEqual(refreshed.stripeCardAuthenticationSetupNeeded, false);
assert.deepStrictEqual(refreshed.stripeChargeAttempt, {});

console.log('Priority, service, and replacement-card runtime check passed.');
