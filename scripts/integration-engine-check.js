const assert = require('assert');
const engine = require('../integration-engine');

const data = {
  customers: [{ id: 'customer-1', name: 'Test Customer', phone: '8565550100', email: 'test@example.com', vehicleId: 'vehicle-1' }],
  contracts: [],
  recurringPayments: [],
  vehicles: [{ id: 'vehicle-1', year: 2018, make: 'Ford', model: 'Focus', vin: 'VIN123456789', plate: 'ABC123', tracker: 'Track One', currentCustomer: 'Test Customer' }],
  payments: [
    { id: 'payment-1', customer: 'Test Customer', vehicleId: 'vehicle-1', amount: 229, status: 'Paid', date: '2026-07-15', method: 'Clover saved card', cloverPaymentId: 'clover-payment-1' },
    { id: 'payment-failed', customer: 'Test Customer', amount: 229, status: 'FAIL', date: '2026-07-15' }
  ],
  refundRequests: [{ id: 'refund-1', sourcePaymentId: 'payment-1', customer: 'Test Customer', vehicleId: 'vehicle-1', amount: 229, status: 'Refunded', providerRefundId: 'provider-refund-1', date: '2026-07-15' }],
  maintenance: [{ id: 'service-1', customer: 'Test Customer', vehicleId: 'vehicle-1', cost: 75, status: 'Done', date: '2026-07-14' }],
  claims: [{ id: 'claim-1', customer: 'Test Customer', vehicleId: 'vehicle-1', type: 'Toll reimbursement', amount: 12.5, paidAmount: 12.5, status: 'Paid', date: '2026-07-13' }],
  pickupAppointments: [{ id: 'pickup-1', customer: 'Test Customer', phone: '8565550100', vehicle: '2018 Ford Focus', vin: 'VIN123456789', plate: 'ABC123', date: '2026-07-20', time: '2:30 PM', durationMinutes: 30, address: '5150 NJ-42, Blackwood, NJ 08012', status: 'Scheduled' }],
  publicSite: { pickupAddress: '5150 NJ-42, Blackwood, NJ 08012', pickupSlotMinutes: 60 },
  integrations: { clover: {} }
};

const created = engine.verificationCase(data, {
  type: 'driver_license',
  customer: 'Test Customer',
  driverLicenseId: 'NJ-PRIVATE-1234',
  expiresAt: '2027-07-15'
}, { name: 'Owner admin' });
assert.equal(created.created, true);
assert.equal(created.record.referenceLast4, '1234');
assert.equal(JSON.stringify(created.record).includes('NJ-PRIVATE-1234'), false, 'Full driver-license value must not be saved in a verification case.');
assert.equal(created.record.vehicleId, 'vehicle-1');
assert.equal(created.record.vin, 'VIN123456789');

const duplicate = engine.verificationCase({ ...data, verificationCases: [created.record] }, {
  type: 'driver_license',
  customer: 'Test Customer',
  driverLicenseId: 'NJ-PRIVATE-1234',
  expiresAt: '2027-07-15'
}, { name: 'Owner admin' });
assert.equal(duplicate.created, false, 'Open verification cases must be idempotent.');

engine.reviewVerificationCase(created.record, { decision: 'approve', notes: 'Identity compared to the uploaded license.' }, { name: 'Manager' });
assert.equal(created.record.status, 'Verified');
assert.equal(created.record.reviewedBy, 'Manager');

const providerCase = engine.verificationCase(data, {
  type: 'insurance',
  customer: 'Test Customer',
  provider: 'provider-adapter',
  externalCaseId: 'insurance-case-1',
  policyNumber: 'POLICY-5555'
}, { name: 'Owner admin' }).record;
engine.applyVerificationEvent(providerCase, { externalCaseId: 'insurance-case-1', status: 'approved', expiresAt: '2026-07-30', provider: 'Insurance provider' });
assert.equal(providerCase.status, 'Expiring');
assert.equal(providerCase.policyNumberLast4, '5555');
engine.reviewVerificationCase(providerCase, { decision: 'approve', notes: 'Manual review before authoritative callback.' }, { name: 'Manager' });
engine.applyVerificationEvent(providerCase, { externalCaseId: 'insurance-case-1', status: 'rejected', provider: 'Insurance provider' });
assert.equal(providerCase.status, 'Rejected', 'Authoritative provider results must supersede an earlier manual decision.');

const ledger = engine.buildAccountingLedger(data, [{ sourceKey: 'payment:payment-1', quickBooksStatus: 'Synced', quickBooksEntityId: 'qb-1' }]);
assert.equal(ledger.filter(row => row.sourceKey === 'payment:payment-1').length, 1);
assert.equal(ledger.some(row => row.sourceKey === 'payment:payment-failed'), false, 'Failed payments must not enter the accounting ledger.');
assert.equal(ledger.find(row => row.sourceKey === 'payment:payment-1').quickBooksStatus, 'Synced');
assert.equal(ledger.find(row => row.sourceKey === 'refund:refund-1').signedAmount, -229);
assert.equal(ledger.find(row => row.sourceKey === 'maintenance:service-1').signedAmount, -75);
assert.equal(ledger.find(row => row.sourceKey === 'claim:claim-1').signedAmount, 12.5);
assert.equal(ledger.every(row => row.customer === 'Test Customer'), true);
assert.equal(ledger.every(row => row.vin === 'VIN123456789'), true);

const quickBooksRows = engine.buildQuickBooksJournalRows(ledger);
assert.equal(quickBooksRows.length, ledger.length * 2, 'Every accounting source must create one balanced QuickBooks debit/credit pair.');
const journals = new Map();
quickBooksRows.forEach(row => {
  const totals = journals.get(row.journalNo) || { debit: 0, credit: 0, lines: 0 };
  totals.debit += Number(row.debit || 0);
  totals.credit += Number(row.credit || 0);
  totals.lines += 1;
  journals.set(row.journalNo, totals);
});
journals.forEach(totals => {
  assert.equal(totals.lines, 2, 'Each QuickBooks journal must have exactly two lines.');
  assert.equal(totals.debit, totals.credit, 'Each QuickBooks journal must balance.');
});
assert(quickBooksRows.some(row => row.account === 'Clover Clearing'), 'Clover payments/refunds must map through the Clover clearing account.');
assert(quickBooksRows.some(row => row.account === 'Rental Income'), 'Rental payments must map to rental income.');
assert(quickBooksRows.some(row => row.account === 'Repairs and Maintenance'), 'Maintenance costs must map to repairs and maintenance.');

const calendar = engine.pickupCalendarEvent(data.pickupAppointments[0], data.publicSite);
assert.match(calendar.googleCalendarUrl, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
assert.match(calendar.mapsUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
assert.match(calendar.ics, /UID:pickup-/);
assert.match(calendar.ics, /DTSTART;TZID=America\/New_York:20260720T143000/);
assert.match(calendar.ics, /LOCATION:5150 NJ-42\\, Blackwood\\, NJ 08012/);
assert.equal(engine.pickupCalendarEvent(data.pickupAppointments[0], data.publicSite).id, calendar.id, 'Pickup calendar IDs must be deterministic.');
assert.equal(engine.buildPickupCalendarEvents(data).length, 1);

console.log('Integration engine checks passed.');
