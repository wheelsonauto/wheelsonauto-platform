'use strict';

const assert = require('node:assert/strict');

process.env.WOA_AUTO_SYNC_MS = '3600000';
process.env.WOA_AUTOPAY_MS = '3600000';
process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';

const { mergeConcurrentState, mergeConcurrentValue } = require('../server');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const base = {
  recurringPayments: [{
    id: 'rec-concurrent-1',
    customer: 'Concurrent Customer',
    amount: 229,
    status: 'Active',
    retryCount: 0,
    schedule: { nextRun: '2026-07-24', chargeTime: '18:00' },
    stripeMigration: { state: 'stripe_card_saved', setupAt: '2026-07-17T12:00:00.000Z' },
    history: [{ id: 'created', action: 'Created' }]
  }],
  payments: [{
    id: 'payment-concurrent-1',
    customer: 'Concurrent Customer',
    amount: 229,
    status: 'Paid',
    notes: 'Original note',
    refundedAmount: 0,
    stripePaymentIntentId: 'pi_concurrent_1'
  }],
  customers: [{
    id: 'customer-concurrent-1',
    name: 'Concurrent Customer',
    phone: '8565550100',
    vehicleId: 'vehicle-old'
  }],
  vehicles: [{ id: 'vehicle-delete-1', year: '2019', make: 'Mitsubishi', model: 'Mirage', status: 'Rented' }],
  tasks: [{ id: 'task-existing', title: 'Existing task', status: 'Open' }],
  integrations: { stripe: { lastWebhookEventId: 'evt-base' } }
};

const incoming = clone(base);
const incomingRecurring = incoming.recurringPayments[0];
incomingRecurring.amount = 249;
incomingRecurring.schedule.chargeTime = '19:00';
incomingRecurring.history.push({ id: 'staff-edit', action: 'Amount edited by owner' });
incoming.payments[0].notes = 'Owner reviewed the refund request.';
incoming.customers[0].phone = '8565550199';
incoming.vehicles = [];
incoming.tasks.push({ id: 'task-owner', title: 'Owner task', status: 'Open' });

const latest = clone(base);
const latestRecurring = latest.recurringPayments[0];
latestRecurring.status = 'Failed once';
latestRecurring.retryCount = 1;
latestRecurring.stripeMigration.lastWebhookAt = '2026-07-17T13:00:00.000Z';
latestRecurring.history.push({ id: 'webhook-failure', action: 'Stripe failure received' });
latest.payments[0].refundedAmount = 42.25;
latest.payments[0].refundStatus = 'Partially refunded';
latest.customers[0].vehicleId = 'vehicle-new';
latest.vehicles[0].status = 'Ready';
latest.tasks.push({ id: 'task-worker', title: 'Worker task', status: 'Open' });
latest.integrations.stripe.lastWebhookEventId = 'evt-latest';

const merged = mergeConcurrentState(incoming, latest, {
  preferIncoming: true,
  preserveLatestIntegrations: true,
  baseState: base,
  deletedIds: { vehicles: ['vehicle-delete-1'] }
});

const recurring = merged.recurringPayments.find(row => row.id === 'rec-concurrent-1');
assert.strictEqual(recurring.amount, 249, 'The owner amount edit must win.');
assert.strictEqual(recurring.schedule.chargeTime, '19:00', 'The owner charge-time edit must win.');
assert.strictEqual(recurring.schedule.nextRun, '2026-07-24', 'An unchanged schedule field must survive.');
assert.strictEqual(recurring.status, 'Failed once', 'A concurrent webhook status must survive the owner edit.');
assert.strictEqual(recurring.retryCount, 1, 'A concurrent retry count must survive the owner edit.');
assert.strictEqual(recurring.stripeMigration.state, 'stripe_card_saved', 'Existing migration state must survive.');
assert.strictEqual(recurring.stripeMigration.lastWebhookAt, '2026-07-17T13:00:00.000Z', 'A nested webhook field must survive.');
assert.deepStrictEqual(new Set(recurring.history.map(row => row.id)), new Set(['created', 'staff-edit', 'webhook-failure']), 'Concurrent history appends must both survive.');

const payment = merged.payments.find(row => row.id === 'payment-concurrent-1');
assert.strictEqual(payment.notes, 'Owner reviewed the refund request.', 'The owner payment note must survive.');
assert.strictEqual(payment.refundedAmount, 42.25, 'The concurrent refund amount must survive.');
assert.strictEqual(payment.refundStatus, 'Partially refunded', 'The concurrent refund status must survive.');
assert.strictEqual(payment.customer, 'Concurrent Customer', 'The matched customer identity must remain intact.');

const customer = merged.customers.find(row => row.id === 'customer-concurrent-1');
assert.strictEqual(customer.phone, '8565550199', 'The owner phone edit must survive.');
assert.strictEqual(customer.vehicleId, 'vehicle-new', 'The concurrent vehicle assignment must survive.');
assert.strictEqual(merged.vehicles.some(row => row.id === 'vehicle-delete-1'), false, 'An explicit deletion must not be resurrected by a concurrent update.');
assert(merged.tasks.some(row => row.id === 'task-owner') && merged.tasks.some(row => row.id === 'task-worker'), 'Concurrent record additions must both survive.');
assert.strictEqual(merged.integrations.stripe.lastWebhookEventId, 'evt-latest', 'Server-only integration evidence must keep the latest value.');

const conflict = mergeConcurrentValue({ amount: 229 }, { amount: 249 }, { amount: 239 }, true);
assert.strictEqual(conflict.amount, 249, 'When both writers change the exact same field, the explicitly saved incoming action must win.');

const backgroundIncoming = clone(base);
backgroundIncoming.recurringPayments[0].retryCount = 1;
const ownerLatest = clone(base);
ownerLatest.recurringPayments[0].amount = 239;
const latestPreferred = mergeConcurrentState(backgroundIncoming, ownerLatest, { preferIncoming: false, baseState: base });
assert.strictEqual(latestPreferred.recurringPayments[0].amount, 239, 'The latest owner field must survive a background merge.');
assert.strictEqual(latestPreferred.recurringPayments[0].retryCount, 1, 'A non-conflicting background field must still be applied.');

const backgroundConflict = clone(base);
backgroundConflict.recurringPayments[0].amount = 249;
const ownerConflict = clone(base);
ownerConflict.recurringPayments[0].amount = 239;
const latestConflict = mergeConcurrentState(backgroundConflict, ownerConflict, { preferIncoming: false, baseState: base });
assert.strictEqual(latestConflict.recurringPayments[0].amount, 239, 'When both writers change the exact same field, latest-preferred synchronization must retain the database value.');

const starHealthWrite = clone(base);
starHealthWrite.integrations.messaging = {
  lastAiHealthAt: '2026-07-20T10:30:00.000Z',
  lastAiHealthStatus: 'OpenAI answered through the Responses API and Star sanitized the plan.',
  lastAiProvider: 'openai'
};
const backgroundProviderWrite = clone(base);
backgroundProviderWrite.integrations.verification = { lastMonitorAt: '2026-07-20T10:30:01.000Z', checked: 57 };
const providerMerged = mergeConcurrentState(starHealthWrite, backgroundProviderWrite, { preferIncoming: true, baseState: base });
assert.strictEqual(providerMerged.integrations.messaging.lastAiProvider, 'openai', 'A Star health proof must survive a concurrent background integration write.');
assert.strictEqual(providerMerged.integrations.verification.checked, 57, 'A background provider update must survive the concurrent Star health proof write.');
const delayedBackground = clone(base);
delayedBackground.integrations.verification = { lastMonitorAt: '2026-07-20T10:30:02.000Z', checked: 58 };
const proofAlreadySaved = clone(base);
proofAlreadySaved.integrations.messaging = clone(starHealthWrite.integrations.messaging);
const delayedProviderMerged = mergeConcurrentState(delayedBackground, proofAlreadySaved, { preferIncoming: true, baseState: base });
assert.strictEqual(delayedProviderMerged.integrations.messaging.lastAiHealthAt, '2026-07-20T10:30:00.000Z', 'A delayed worker that read before the Star test must not erase the saved provider proof.');
assert.strictEqual(delayedProviderMerged.integrations.verification.checked, 58, 'The delayed worker must still apply its own non-conflicting integration update.');

assert.strictEqual(base.recurringPayments[0].amount, 229, 'Three-way merging must not mutate the read baseline.');
assert.strictEqual(latest.payments[0].refundedAmount, 42.25, 'Three-way merging must not mutate the latest database state object.');

console.log('Concurrent state merge check passed: staff edits, webhook/payment updates, nested history, additions, deletions, and concurrent provider proofs remain coherent.');
