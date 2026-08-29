const assert = require('node:assert/strict');
const {
  applyRecurringCollectionPolicy,
  customerDueDateKey,
  dashboardMaintenanceVisible,
  dashboardPriorityFeed,
  queueCustomerDueReminders,
  queueRecurringBillingReminders,
  recordDateKey,
  recurringCollectionState
} = require('../server');

function baseData() {
  return {
    recurringPayments: [], payments: [], claims: [], messages: [], tasks: [], maintenance: [], vehicles: [], rentalFiles: [], customers: [], customerAccounts: [], integrations: { clover: {} }
  };
}

assert.equal(recordDateKey('2026-08-29T00:30:00.000Z'), '2026-08-28', 'UTC evening payments must stay on the New Jersey business date.');
assert.equal(recordDateKey('2026-08-28'), '2026-08-28', 'Calendar due dates must remain calendar dates.');

async function main() {
{
  const data = baseData();
  data.payments = [
    { id: 'paid-late-evening', customer: 'Alex Driver', amount: 100, status: 'Succeeded', createdAt: '2026-08-29T00:30:00.000Z', cardLast4: '4242' },
    { id: 'failed-second', customer: 'Alex Driver', amount: 100, status: '2x failed - contact customer', createdAt: '2026-08-28T23:15:00.000Z', cardLast4: '4242' },
    { id: 'older-paid', customer: 'Alex Driver', amount: 25, status: 'Paid', createdAt: '2026-08-27T17:00:00.000Z' }
  ];
  const feed = dashboardPriorityFeed(data, '2026-08-28');
  assert.equal(feed.summary.collectedAmount, 100, 'Collected today must include successful payments on the business day only.');
  assert.equal(feed.summary.collectedCount, 1);
  assert.deepEqual(feed.transactions.map(row => row.id), ['paid-late-evening', 'failed-second', 'older-paid'], 'Transactions must be newest-first by the exact event timestamp.');
  assert.equal(feed.transactions.find(row => row.id === 'failed-second').status, '2x failed - contact customer');
}

{
  const claim = { id: 'claim-legacy', createdAt: '2026-08-01T15:00:00.000Z', amount: 20, status: 'Open' };
  assert.equal(customerDueDateKey(claim), '2026-08-15', 'Blank non-weekly dues must default to 14 calendar days.');
  const data = baseData();
  data.claims.push({ ...claim, customer: 'Alex Driver' });
  queueCustomerDueReminders(data, new Date('2026-08-14T14:00:00.000Z'));
  queueCustomerDueReminders(data, new Date('2026-08-14T14:01:00.000Z'));
  assert.equal(data.claims[0].due, '2026-08-15');
  assert.equal(data.messages.length, 1, 'A due-tomorrow app notice must be idempotent.');
  assert.equal(data.messages[0].channel, 'Customer portal');
}

{
  const data = baseData();
  const row = { id: 'rec-reminder', customer: 'Alex Driver', customerAccountId: 'account-1', amount: 200, frequency: 'Weekly', nextRun: '2026-08-15', chargeTime: '18:00', status: 'Active' };
  data.recurringPayments.push(row);
  queueRecurringBillingReminders(data, new Date('2026-08-14T14:00:00.000Z'));
  queueRecurringBillingReminders(data, new Date('2026-08-14T14:01:00.000Z'));
  assert.equal(data.messages.length, 1, 'A recurring reminder must be emitted once for an exact occurrence and phase.');
  assert.match(data.messages[0].body, /due tomorrow/i);
  assert.doesNotMatch(data.messages[0].body, /grace/i, 'Customer notices must not expose internal grace-window language.');
}

{
  const data = baseData();
  const vehicle = { id: 'vehicle-lot', year: '2019', make: 'Test', model: 'Car', status: 'Ready', currentCustomer: '' };
  const job = { id: 'monthly-lot', vehicleId: vehicle.id, type: 'Monthly inspection', due: '2026-08-01', status: 'Scheduled' };
  data.vehicles.push(vehicle);
  assert.equal(dashboardMaintenanceVisible(data, job), false, 'Routine maintenance must stay off the schedule while the vehicle is in the lot.');
  vehicle.currentCustomer = 'Alex Driver';
  assert.equal(dashboardMaintenanceVisible(data, job), true, 'Routine maintenance must start once the vehicle is rented.');
}

{
  const data = baseData();
  const recurring = { id: 'rec-partial', customer: 'Alex Driver', amount: 200, frequency: 'Weekly', nextRun: '2026-08-25', status: '2x failed - contact customer', retryCount: 2, customerPortalCreditBalance: 70 };
  data.recurringPayments.push(recurring);
  const extended = recurringCollectionState(data, recurring, new Date('2026-08-27T18:00:00.000Z'));
  assert.equal(extended.paidRatio, 0.35);
  assert.equal(extended.lateFeeDue, false, 'A 35% partial payment must extend the collection deadline.');
  const final = recurringCollectionState(data, recurring, new Date('2026-08-29T18:00:00.000Z'));
  assert.equal(final.lateFeeDue, true);
  assert.equal(final.towReviewDue, true);
  await applyRecurringCollectionPolicy(data, new Date('2026-08-29T18:00:00.000Z'));
  await applyRecurringCollectionPolicy(data, new Date('2026-08-29T18:01:00.000Z'));
  assert.equal(data.claims.filter(row => row.type === 'Late fee').length, 1, 'The automatic $50 late fee must be created once per billing occurrence.');
  assert.equal(data.claims[0].amount, 50);
  assert.equal(data.tasks.filter(row => row.type === 'Vehicle recovery review').length, 1, 'Day-three recovery review must be created once.');
}

console.log('Dashboard billing policy checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
