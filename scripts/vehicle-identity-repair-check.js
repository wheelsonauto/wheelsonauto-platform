'use strict';

const assert = require('node:assert');
const vehicleIdentityRepair = require('../vehicle-identity-repair');

function liveStyleState() {
  return {
    vehicles: [
      { id: 'veh-sheet-004', year: '2017', make: 'Chevy', model: 'trax Red', vin: '3GNCJNSB9HL190487', plate: 'M97wuv', status: 'Rented', currentCustomer: 'Rudolph vernon Hawkes', sourceRow: 51 },
      { id: 'veh-sheet-004', year: '2014', make: 'Dodge', model: 'Ram Cargo', vin: '2C4JRGAG5ER182015', plate: 'Y61www', status: 'Rented', currentCustomer: 'Dominique tatiana bruce', sourceRow: 4 }
    ],
    maintenance: [
      { id: 'mnt-sheet-oil-overdue-51', vehicleId: 'veh-sheet-004', vehicle: '2017 Chevy trax Red', customer: 'Rudolph vernon Hawkes', sourceRow: 51, status: 'Scheduled' },
      { id: 'mnt-sheet-oil-overdue-4', vehicleId: 'veh-sheet-004', vehicle: '2014 Dodge Ram Cargo', customer: 'Dominique tatiana bruce', sourceRow: 4, status: 'Scheduled' }
    ]
  };
}

function main() {
  const source = liveStyleState();
  const sourceBefore = JSON.stringify(source);
  const repaired = vehicleIdentityRepair.repairDuplicateVehicleIdentities(source, { requireResolvableReferences: true });
  assert.strictEqual(repaired.ready, true, 'Unique VIN/source/customer evidence should permit deterministic protected-copy repair.');
  assert.strictEqual(JSON.stringify(source), sourceBefore, 'Protected-copy repair must not mutate its source.');
  assert.strictEqual(repaired.repairs.length, 1, 'Only the later colliding vehicle should receive a new stable ID.');
  assert.strictEqual(repaired.referenceRepairs.length, 1, 'Only the reference belonging to the re-keyed vehicle should change.');
  assert.strictEqual(repaired.resolvedReferences.length, 2, 'Both duplicate-ID references must be uniquely resolved, including the retained ID.');
  assert.strictEqual(new Set(repaired.state.vehicles.map(vehicle => vehicle.id)).size, 2, 'Both vehicles must have unique IDs after repair.');
  assert.strictEqual(repaired.state.vehicles[0].id, 'veh-sheet-004', 'The first valid vehicle identity must stay stable.');
  assert.match(repaired.state.vehicles[1].id, /^veh-sheet-004-[a-f0-9]{10}$/, 'The later vehicle must receive a stable VIN-derived ID.');
  assert.strictEqual(repaired.state.maintenance[0].vehicleId, repaired.state.vehicles[0].id, 'The Chevy service row must remain attached to the Chevy.');
  assert.strictEqual(repaired.state.maintenance[1].vehicleId, repaired.state.vehicles[1].id, 'The Dodge service row must move with the Dodge ID.');

  const repeated = vehicleIdentityRepair.repairDuplicateVehicleIdentities(repaired.state, { requireResolvableReferences: true });
  assert.strictEqual(repeated.repairs.length, 0, 'The repair must be idempotent after IDs are unique.');
  assert.strictEqual(repeated.referenceRepairs.length, 0, 'An idempotent second pass must not rewrite references.');

  const ambiguous = liveStyleState();
  ambiguous.maintenance = [{ id: 'mnt-ambiguous', vehicleId: 'veh-sheet-004', status: 'Scheduled' }];
  const ambiguousResult = vehicleIdentityRepair.repairDuplicateVehicleIdentities(ambiguous, { requireResolvableReferences: true });
  assert.strictEqual(ambiguousResult.ready, false, 'A reference with no matching evidence must block a migration copy.');
  assert.strictEqual(ambiguousResult.unresolvedReferences.length, 1);
  assert.strictEqual(ambiguous.vehicles[1].id, 'veh-sheet-004', 'A refused protected-copy repair must leave the source untouched.');

  const missingVin = liveStyleState();
  delete missingVin.vehicles[1].vin;
  const missingVinResult = vehicleIdentityRepair.repairDuplicateVehicleIdentities(missingVin, { requireResolvableReferences: true });
  assert.strictEqual(missingVinResult.ready, false, 'Non-identical duplicate vehicles without distinct VINs must require owner review.');
  assert.strictEqual(missingVinResult.conflicts[0].kind, 'duplicate_vehicle_identity_requires_review');

  const exactVehicle = liveStyleState().vehicles[0];
  const exactDuplicates = vehicleIdentityRepair.repairDuplicateVehicleIdentities({ vehicles: [exactVehicle, { ...exactVehicle }] }, { requireResolvableReferences: true });
  assert.strictEqual(exactDuplicates.ready, true, 'Byte-equivalent duplicates remain eligible for the existing exact-collapse policy.');
  assert.strictEqual(exactDuplicates.repairs.length, 0, 'Exact duplicates must not be re-keyed as different vehicles.');

  const mutable = liveStyleState();
  const mutableResult = vehicleIdentityRepair.repairDuplicateVehicleIdentities(mutable, { mutate: true });
  assert.strictEqual(mutableResult.state, mutable, 'Runtime repair should support an explicit in-place mode.');
  assert.strictEqual(mutable.maintenance[1].vehicleId, mutable.vehicles[1].id, 'Runtime repair must keep maintenance attached to the correct re-keyed vehicle.');

  console.log('Vehicle identity repair check passed: source preservation, VIN-derived IDs, deterministic reference repair, ambiguity refusal, missing-VIN refusal, exact-duplicate handoff, idempotence, and runtime mode are verified.');
}

main();
