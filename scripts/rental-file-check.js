const assert = require('node:assert');
const rentalFiles = require('../rental-file');

function fixture() {
  return {
    rentalFiles: [],
    vehicles: [{ id: 'vehicle-1', organizationId: 'org-wheelsonauto', year: 2020, make: 'Test', model: 'Sedan', vin: 'VIN-ONE', plate: 'PLATE-1', mileage: 41000 }],
    onlineVehicles: [{ id: 'online-1', organizationId: 'org-wheelsonauto', platformVehicleId: 'vehicle-1' }],
    customers: [{ id: 'customer-1', organizationId: 'org-wheelsonauto', name: 'Rental File Customer', applicationId: 'application-1', vehicleId: 'vehicle-1' }],
    applications: [{ id: 'application-1', organizationId: 'org-wheelsonauto', name: 'Rental File Customer', customerId: 'customer-1', vehicleId: 'vehicle-1', onlineVehicleId: 'online-1' }],
    onboardingSessions: [{ id: 'session-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', customerId: 'customer-1', onlineVehicleId: 'online-1' }],
    pickupAppointments: [{ id: 'pickup-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', onboardingSessionId: 'session-1', vehicleId: 'vehicle-1', onlineVehicleId: 'online-1', customer: 'Rental File Customer', status: 'Picked up', date: '2026-07-20', actualPickupDate: '2026-07-20', pickupMileage: 41234, completedAt: '2026-07-20T16:00:00.000Z' }],
    recurringPayments: [{ id: 'recurring-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', onboardingSessionId: 'session-1', pickupAppointmentId: 'pickup-1', customer: 'Rental File Customer', vehicleId: 'vehicle-1', status: 'Active', amount: 229, paymentProvider: 'stripe', paymentDay: 'Monday', nextRun: '2026-07-27' }],
    contracts: [{ id: 'contract-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', onboardingSessionId: 'session-1', customer: 'Rental File Customer', vehicleId: 'vehicle-1', status: 'Active' }],
    paymentRequests: [{ id: 'payment-request-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', onboardingSessionId: 'session-1', customer: 'Rental File Customer', vehicleId: 'vehicle-1', status: 'Paid' }],
    cardSetupRequests: [],
    payments: [],
    documents: [{ id: 'document-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', onboardingSessionId: 'session-1', status: 'Verified' }],
    eSignatures: [{ id: 'signature-1', organizationId: 'org-wheelsonauto', applicationId: 'application-1', onboardingSessionId: 'session-1', status: 'Signed' }],
    messages: [],
    claims: [],
    maintenance: [],
    refundRequests: [],
    verificationCases: [],
    ledgerEntries: [],
    trackerEvents: []
  };
}

const state = fixture();
const context = {
  appointment: state.pickupAppointments[0],
  application: state.applications[0],
  session: state.onboardingSessions[0],
  customer: state.customers[0],
  vehicle: state.vehicles[0],
  onlineVehicle: state.onlineVehicles[0],
  recurring: state.recurringPayments[0],
  contract: state.contracts[0]
};
const first = rentalFiles.upsertFromCompletedPickup(state, context, { name: 'Test manager' });
assert.strictEqual(first.created, true, 'First completed pickup must create a Rental File.');
assert.strictEqual(state.rentalFiles.length, 1, 'One pickup must produce one Rental File.');
assert.strictEqual(first.rentalFile.customerId, 'customer-1');
assert.strictEqual(first.rentalFile.vehicleId, 'vehicle-1');
assert.strictEqual(first.rentalFile.startDate, '2026-07-20');
assert.strictEqual(state.paymentRequests[0].rentalFileId, first.rentalFile.id, 'Exact payment request must link to the Rental File.');
assert.strictEqual(state.documents[0].rentalFileId, first.rentalFile.id, 'Exact private document must link to the Rental File.');
assert.strictEqual(state.vehicles[0].activeRentalFileId, first.rentalFile.id, 'Vehicle must point to its active Rental File.');
assert.strictEqual(state.customers[0].activeRentalFileId, first.rentalFile.id, 'Customer must point to the same active Rental File.');
assert.strictEqual(rentalFiles.rentalForVehicleDate(state, 'vehicle-1', '2026-07-24').id, first.rentalFile.id, 'A dated toll or service event must resolve to the one canonical Rental File active on that date.');
assert.strictEqual(rentalFiles.validateState(state).ok, true, 'Valid Rental File state should pass strict validation.');

const repeated = rentalFiles.upsertFromCompletedPickup(state, context, { name: 'Test manager' });
assert.strictEqual(repeated.created, false, 'Repeated pickup completion must be idempotent.');
assert.strictEqual(state.rentalFiles.length, 1, 'Repeated pickup completion must not duplicate the Rental File.');
const detail = rentalFiles.detailForState(state, first.rentalFile.id);
assert(detail.records.pickupAppointments.some(row => row.id === 'pickup-1'), 'Rental File detail must contain its pickup.');
assert(detail.records.recurringPayments.some(row => row.id === 'recurring-1'), 'Rental File detail must contain its recurring schedule.');

const conflictState = fixture();
conflictState.rentalFiles.push({ id: 'rental-existing', organizationId: 'org-wheelsonauto', customerId: 'other-customer', vehicleId: 'vehicle-1', status: 'Active', startDate: '2026-07-01' });
assert.throws(
  () => rentalFiles.upsertFromCompletedPickup(conflictState, {
    appointment: conflictState.pickupAppointments[0],
    application: conflictState.applications[0],
    session: conflictState.onboardingSessions[0],
    customer: conflictState.customers[0],
    vehicle: conflictState.vehicles[0],
    onlineVehicle: conflictState.onlineVehicles[0],
    recurring: conflictState.recurringPayments[0],
    contract: conflictState.contracts[0]
  }),
  /already belongs to active Rental File/,
  'A vehicle must never receive two active renters.'
);

const backfillState = fixture();
const backfill = rentalFiles.backfillCompletedPickups(backfillState, { name: 'Migration test' });
assert.strictEqual(backfill.created.length, 1, 'Unambiguous completed pickups should backfill safely.');
assert.strictEqual(backfill.conflicts.length, 0, 'Unambiguous completed pickups should not enter the review queue.');

const ambiguousState = fixture();
delete ambiguousState.applications[0].customerId;
delete ambiguousState.onboardingSessions[0].customerId;
ambiguousState.customers.push({ id: 'customer-duplicate', applicationId: 'application-1', vehicleId: 'vehicle-1', name: 'Different Person' });
const ambiguousBackfill = rentalFiles.backfillCompletedPickups(ambiguousState, { name: 'Migration test' });
assert.strictEqual(ambiguousBackfill.created.length, 0, 'Ambiguous customer identity must never be guessed during backfill.');
assert.strictEqual(ambiguousBackfill.conflicts.length, 1, 'Ambiguous completed pickups must be returned for explicit review.');

const returnState = fixture();
const createdReturnRental = rentalFiles.upsertFromCompletedPickup(returnState, {
  appointment: returnState.pickupAppointments[0],
  application: returnState.applications[0],
  session: returnState.onboardingSessions[0],
  customer: returnState.customers[0],
  vehicle: returnState.vehicles[0],
  onlineVehicle: returnState.onlineVehicles[0],
  recurring: returnState.recurringPayments[0],
  contract: returnState.contracts[0]
}, { name: 'Test manager' }).rentalFile;
const returned = rentalFiles.endRentalFile(returnState, createdReturnRental.id, { endDate: '2026-08-20', endingMileage: 42000, vehicleStatus: 'Prep', reason: 'Customer returned the vehicle for inspection.' }, { name: 'Test manager' });
assert.strictEqual(returned.rentalFile.status, 'Returned', 'Return command must end the Rental File.');
assert.strictEqual(returnState.vehicles[0].status, 'Prep', 'Return command must place the vehicle in the selected fleet status.');
assert.strictEqual(returnState.vehicles[0].activeRentalFileId, '', 'Returned vehicle must no longer point to an active Rental File.');
assert.strictEqual(returnState.customers[0].status, 'Returned', 'Return command must move the customer to history.');
assert.strictEqual(returnState.recurringPayments[0].autoChargeEnabled, false, 'Return command must stop recurring charges.');
assert.strictEqual(returnState.contracts[0].endStatus, 'Ended', 'Return command must end the connected contract.');
assert.strictEqual(rentalFiles.rentalForVehicleDate(returnState, 'vehicle-1', '2026-08-01').id, createdReturnRental.id, 'Historical events inside the rental dates must remain attached after return.');
assert.strictEqual(rentalFiles.rentalForVehicleDate(returnState, 'vehicle-1', '2026-08-21'), null, 'Events after a completed return must not attach to the ended Rental File.');
const repeatedReturn = rentalFiles.endRentalFile(returnState, createdReturnRental.id, { endDate: '2026-08-20', endingMileage: 42000 });
assert.strictEqual(repeatedReturn.alreadyEnded, true, 'Repeated return commands must be idempotent.');

console.log('Rental File check passed: immutable identity, exact source links, idempotency, conflict refusal, detail reads, safe completed-pickup backfill, and atomic returns are verified.');
