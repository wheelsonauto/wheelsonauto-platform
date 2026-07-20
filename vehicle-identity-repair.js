'use strict';

const crypto = require('node:crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value === undefined ? {} : value));
}

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function vehicleLabel(vehicle = {}) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ').trim()
    || String(vehicle.name || vehicle.vehicle || '').trim();
}

function vehiclePlate(vehicle = {}) {
  return String(vehicle.plate || vehicle.licensePlate || vehicle.tag || vehicle.stock || '').trim();
}

function uniqueVehicleId(base, vehicle, used) {
  const identity = [vehicle.vin, vehiclePlate(vehicle), vehicle.sourceRow, vehicleLabel(vehicle), vehicle.currentCustomer]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join('|');
  const suffix = digest(identity || canonicalJson(vehicle)).slice(0, 10);
  let candidate = String(base || 'veh') + '-' + suffix;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = String(base || 'veh') + '-' + suffix + '-' + counter;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function referenceScore(row = {}, vehicle = {}) {
  let score = 0;
  const rowVin = normalized(row.vin || row.vehicleVin);
  const candidateVin = normalized(vehicle.vin);
  if (rowVin && candidateVin && rowVin === candidateVin) score += 100;

  const rowSource = String(row.sourceRow || row.vehicleSourceRow || '').trim();
  const candidateSource = String(vehicle.sourceRow || '').trim();
  if (rowSource && candidateSource && rowSource === candidateSource) score += 90;

  const rowPlates = [row.plate, row.licensePlate, row.tag, row.stock].map(normalized).filter(Boolean);
  const candidatePlate = normalized(vehiclePlate(vehicle));
  if (candidatePlate && rowPlates.includes(candidatePlate)) score += 80;

  const rowVehicle = normalized(row.vehicle || row.vehicleName || row.car);
  const candidateVehicle = normalized(vehicleLabel(vehicle));
  if (rowVehicle && candidateVehicle && rowVehicle === candidateVehicle) score += 70;

  const rowCustomer = normalized(row.customer || row.customerName || row.name || row.renter);
  const candidateCustomer = normalized(vehicle.currentCustomer);
  if (rowCustomer && candidateCustomer && rowCustomer === candidateCustomer) score += 60;

  const rowTracker = normalized(row.tracker || row.trackerName);
  const candidateTracker = normalized(vehicle.tracker || vehicle.trackerName);
  if (rowTracker && candidateTracker && rowTracker === candidateTracker) score += 50;
  return score;
}

function repairDuplicateVehicleIdentities(input = {}, options = {}) {
  const state = options.mutate === true ? input : clone(input);
  const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
  const groups = new Map();
  const usedIds = new Set();
  vehicles.forEach((vehicle, index) => {
    const id = String(vehicle && vehicle.id || '').trim();
    if (!id) return;
    usedIds.add(id);
    const rows = groups.get(id) || [];
    rows.push({ vehicle, index });
    groups.set(id, rows);
  });

  const repairs = [];
  const referenceRepairs = [];
  const resolvedReferences = [];
  const unresolvedReferences = [];
  const conflicts = [];

  groups.forEach((rows, originalId) => {
    if (rows.length < 2) return;
    const hashes = [...new Set(rows.map(row => digest(canonicalJson(row.vehicle))))];
    if (hashes.length === 1) return;

    const vins = rows.map(row => normalized(row.vehicle && row.vehicle.vin));
    if (vins.some(vin => !vin) || new Set(vins).size !== rows.length) {
      conflicts.push({
        kind: 'duplicate_vehicle_identity_requires_review',
        vehicleId: originalId,
        indexes: rows.map(row => row.index),
        message: 'Non-identical vehicles sharing one ID must each have a different VIN before they can be re-keyed safely.'
      });
      return;
    }

    const candidates = rows.map((row, position) => {
      const nextId = position === 0 ? originalId : uniqueVehicleId(originalId, row.vehicle, usedIds);
      const previousId = String(row.vehicle.id || '').trim();
      row.vehicle.id = nextId;
      if (nextId !== previousId) {
        repairs.push({
          collection: 'vehicles',
          resourceType: 'vehicle',
          previousId,
          resourceId: nextId,
          vin: String(row.vehicle.vin || '').trim(),
          plate: vehiclePlate(row.vehicle),
          sourceRow: row.vehicle.sourceRow === undefined ? '' : row.vehicle.sourceRow,
          label: vehicleLabel(row.vehicle)
        });
      }
      return { ...row, id: nextId };
    });

    Object.entries(state).forEach(([collection, records]) => {
      if (!Array.isArray(records) || collection === 'vehicles') return;
      records.forEach((record, index) => {
        if (!record || typeof record !== 'object') return;
        ['vehicleId', 'platformVehicleId'].forEach(field => {
          if (String(record[field] || '').trim() !== originalId) return;
          const scored = candidates
            .map(candidate => ({ candidate, score: referenceScore(record, candidate.vehicle) }))
            .filter(result => result.score > 0)
            .sort((left, right) => right.score - left.score);
          const best = scored[0];
          const tied = best && scored.filter(result => result.score === best.score);
          if (!best || tied.length !== 1) {
            unresolvedReferences.push({
              collection,
              index,
              resourceId: String(record.id || record.paymentRequestId || record.recurringPaymentId || '').trim(),
              field,
              vehicleId: originalId,
              candidateVehicleIds: candidates.map(candidate => candidate.id),
              message: best ? 'Reference evidence matches more than one duplicate vehicle.' : 'Reference has no VIN, source row, plate, vehicle name, customer, or tracker evidence.'
            });
            return;
          }
          resolvedReferences.push({
            collection,
            index,
            resourceId: String(record.id || record.paymentRequestId || record.recurringPaymentId || '').trim(),
            field,
            previousVehicleId: originalId,
            vehicleId: best.candidate.id,
            score: best.score
          });
          if (best.candidate.id === originalId) return;
          record[field] = best.candidate.id;
          referenceRepairs.push({
            collection,
            index,
            resourceId: String(record.id || record.paymentRequestId || record.recurringPaymentId || '').trim(),
            field,
            previousVehicleId: originalId,
            vehicleId: best.candidate.id,
            score: best.score
          });
        });
      });
    });
  });

  return {
    state,
    repairs,
    referenceRepairs,
    resolvedReferences,
    unresolvedReferences,
    conflicts,
    ready: conflicts.length === 0 && (options.requireResolvableReferences !== true || unresolvedReferences.length === 0)
  };
}

module.exports = {
  repairDuplicateVehicleIdentities,
  referenceScore,
  vehicleLabel,
  vehiclePlate
};
