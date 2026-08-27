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
    { id: 'due-today', customer: 'Due Today', amount: 225, nextRun: today, status: 'Active', paymentProvider: 'stripe' },
    { id: 'failed-twice', customer: 'Call Now', amount: 250, nextRun: '2026-01-01', status: 'Failed - contact', failedAttempts: 2, paymentProvider: 'stripe' },
    { id: 'failed-once', customer: 'Retry Customer', amount: 210, nextRun: today, status: '1x failed - retrying', failedAttempts: 1, paymentProvider: 'stripe' },
    { id: 'already-paid', customer: 'Already Paid', amount: 200, nextRun: today, status: 'Active', lastAutoChargeDate: today, paymentProvider: 'stripe' }
  ],
  payments: [{ id: 'paid-today', customer: 'Already Paid', amount: 200, status: 'Paid', date: today }],
  maintenance: [
    { id: 'scheduled', customer: 'Scheduled Customer', status: 'Appointment scheduled', due: today },
    { id: 'complete', customer: 'Complete Customer', status: 'Completed', due: today },
    { id: 'needed', customer: 'Service Customer', status: 'Service needed', due: today },
    { id: 'urgent', customer: 'Urgent Customer', status: 'Urgent - staff contact now', due: today },
    { id: 'late-inspection', customer: 'Inspection Customer', vehicle: '2018 Test Car', type: 'Monthly inspection', status: 'Due', due: shiftDay(-15) },
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
assert.deepStrictEqual(feed.serviceNeeded.map(row => row.id).sort(), ['needed', 'urgent']);
assert.deepStrictEqual(feed.overdueDues.map(row => row.id), ['late-toll']);
assert.deepStrictEqual(feed.inspections.map(row => row.id), ['late-inspection']);
assert.deepStrictEqual(feed.pickups.map(row => row.id), ['pickup-today']);
assert.deepStrictEqual(feed.returns.map(row => row.id), ['return-today']);
assert(feed.completedToday.some(row => row.id === 'done-task') && feed.completedToday.some(row => row.id === 'completed-service'));
assert.strictEqual(feed.summary.collectedAmount, 200);

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
