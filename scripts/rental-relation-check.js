'use strict';

const assert = require('node:assert');
const stateRepository = require('../state-repository');

function baseState() {
  return {
    rentalFiles: [{
      id: 'rental-1',
      customerId: 'customer-1',
      customerName: 'Rental One Customer',
      vehicleId: 'vehicle-1',
      status: 'Active',
      lifecycle: 'Active rental',
      startDate: '2026-07-27',
      applicationId: 'application-1',
      recurringPaymentId: 'recurring-1',
      weeklyAmount: 325,
      sourceRefs: [
        { collection: 'applications', id: 'application-1' },
        { collection: 'recurringPayments', id: 'recurring-1' }
      ]
    }],
    applications: [{ id: 'application-1', rentalFileId: 'rental-1' }],
    recurringPayments: [{ id: 'recurring-1', rentalFileId: 'rental-1' }]
  };
}

async function main() {
  const projection = stateRepository.rentalRelationRows(baseState());
  assert.strictEqual(projection.rentals.length, 1, 'One canonical Rental File must produce one relational row.');
  assert.strictEqual(projection.rentals[0].active, true, 'An active Rental File must retain active relational status.');
  assert.strictEqual(projection.rentals[0].weeklyAmountCents, 32500, 'Weekly money must be stored as integer cents.');
  assert.deepStrictEqual(projection.links.map(link => link.resourceType), ['application', 'recurring_payment'], 'Exact source records must be linked once without duplicating sourceRefs and record links.');

  const assignmentConflict = baseState();
  assignmentConflict.vehicles = [{ id: 'vehicle-1', status: 'Rented', currentCustomer: 'Rental One Customer' }];
  assignmentConflict.recurringPayments.push({ id: 'recurring-other', vehicleId: 'vehicle-1', customer: 'Different Customer', status: 'Active' });
  const activeConflict = stateRepository.activeAssignmentIdentityConflicts(assignmentConflict);
  assert.strictEqual(activeConflict.length, 1, 'An active Rental File must participate in assignment conflict detection.');
  assert(activeConflict[0].claims.some(claim => claim.source === 'rental_file' && claim.customer === 'Rental One Customer'), 'The canonical Rental File must be visible as the authoritative assignment claim.');
  assert.throws(
    () => stateRepository.activeAssignmentIndexRows(assignmentConflict),
    error => error && error.code === 'woa_assignment_identity_conflict',
    'PostgreSQL assignment projection must reject a recurring plan for a different renter while a Rental File is active.'
  );

  const returnedAssignment = baseState();
  returnedAssignment.vehicles = [{ id: 'vehicle-1', status: 'Rented', currentCustomer: 'Different Customer' }];
  returnedAssignment.rentalFiles[0].status = 'Returned';
  returnedAssignment.rentalFiles[0].endDate = '2026-08-27';
  returnedAssignment.recurringPayments.push({ id: 'recurring-other', vehicleId: 'vehicle-1', customer: 'Different Customer', status: 'Active' });
  assert.doesNotThrow(() => stateRepository.activeAssignmentIndexRows(returnedAssignment), 'A returned Rental File must not block the next verified renter.');

  const duplicateVehicle = baseState();
  duplicateVehicle.rentalFiles.push({ id: 'rental-2', customerId: 'customer-2', vehicleId: 'vehicle-1', status: 'Active', startDate: '2026-07-28' });
  assert.throws(
    () => stateRepository.rentalRelationRows(duplicateVehicle),
    error => error && error.code === 'woa_active_rental_vehicle_conflict',
    'One vehicle must never have two active relational Rental Files.'
  );

  const duplicateCustomer = baseState();
  duplicateCustomer.rentalFiles.push({ id: 'rental-2', customerId: 'customer-1', vehicleId: 'vehicle-2', status: 'Active', startDate: '2026-07-28' });
  assert.throws(
    () => stateRepository.rentalRelationRows(duplicateCustomer),
    error => error && error.code === 'woa_active_rental_customer_conflict',
    'One customer must never have two active relational Rental Files.'
  );

  const conflictingLink = baseState();
  conflictingLink.rentalFiles.push({
    id: 'rental-2',
    customerId: 'customer-2',
    vehicleId: 'vehicle-2',
    status: 'Returned',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    sourceRefs: [{ collection: 'recurringPayments', id: 'recurring-1' }]
  });
  assert.throws(
    () => stateRepository.rentalRelationRows(conflictingLink),
    error => error && error.code === 'woa_rental_relation_conflict',
    'One payment record must never belong to two Rental Files.'
  );

  const orphanLink = baseState();
  orphanLink.applications.push({ id: 'application-orphan', rentalFileId: 'rental-missing' });
  assert.throws(
    () => stateRepository.rentalRelationRows(orphanLink),
    error => error && error.code === 'woa_rental_link_orphan',
    'A source record must never point to a missing Rental File.'
  );

  const repository = Object.create(stateRepository.PostgresStateRepository.prototype);
  repository.organizationId = 'org-rental-relation-check';
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const highest = [...String(sql).matchAll(/\$(\d+)/g)].reduce((value, match) => Math.max(value, Number(match[1])), 0);
      assert.strictEqual(values.length, highest, 'Every canonical Rental File SQL statement must have exact parameter alignment.');
      calls.push(String(sql));
      return { rowCount: 1, rows: [] };
    }
  };
  await repository.syncRentalRelations(client, baseState(), 17);
  assert(calls.some(sql => /INSERT INTO woa_rental_files/i.test(sql)), 'The relational projection must persist canonical Rental Files.');
  assert(calls.some(sql => /INSERT INTO woa_rental_links/i.test(sql)), 'The relational projection must persist exact source links.');

  console.log('Canonical Rental File relational check passed: unique active vehicle/customer ownership, exact source links, orphan protection, integer money, and SQL alignment verified.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
