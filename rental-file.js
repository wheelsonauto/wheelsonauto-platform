const crypto = require('crypto');

const ACTIVE_RENTAL_PATTERN = /\b(active|picked up|rented)\b/i;
const INACTIVE_RENTAL_PATTERN = /\b(ended|returned|closed|cancelled|canceled|history|inactive|removed)\b/i;
const RENTAL_LINK_COLLECTIONS = Object.freeze([
  'applications',
  'onboardingSessions',
  'pickupAppointments',
  'contracts',
  'recurringPayments',
  'paymentRequests',
  'cardSetupRequests',
  'payments',
  'documents',
  'eSignatures',
  'messages',
  'claims',
  'maintenance',
  'refundRequests',
  'verificationCases',
  'ledgerEntries',
  'trackerEvents'
]);

function text(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalizedIdentity(value) {
  return text(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function rows(state, collection) {
  return Array.isArray(state && state[collection]) ? state[collection] : [];
}

function stableRentalFileId(context = {}) {
  const organizationId = text(context.organizationId || 'org-wheelsonauto', 160);
  const anchor = text(
    context.pickupAppointmentId
      || context.applicationId
      || context.contractId
      || context.recurringPaymentId
      || [context.customerId, context.vehicleId, context.startDate].filter(Boolean).join('|'),
    500
  );
  if (!anchor) throw new Error('A stable pickup, application, contract, or assignment reference is required to create a Rental File.');
  return 'rental-' + crypto.createHash('sha256').update(organizationId + '|' + anchor).digest('hex').slice(0, 24);
}

function isActiveRentalFile(record = {}) {
  const status = text(record.status || record.lifecycle || '');
  return ACTIVE_RENTAL_PATTERN.test(status) && !INACTIVE_RENTAL_PATTERN.test(status) && !record.endedAt && !record.endDate;
}

function rentalVehicleName(vehicle = {}, fallback = '') {
  return text(vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || fallback, 240);
}

function recordId(record = {}) {
  return text(record.id || record.paymentRequestId || record.recurringPaymentId || record.providerPaymentId || record.stripePaymentIntentId || record.cloverPaymentId, 240);
}

function sourceReference(collection, record) {
  const id = recordId(record);
  return id ? { collection, id } : null;
}

function uniqueSourceReferences(references = []) {
  const seen = new Set();
  return references.filter(Boolean).filter(reference => {
    const key = text(reference.collection) + ':' + text(reference.id);
    if (!reference.collection || !reference.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertCompatibleLink(record, rentalFileId, label) {
  const existing = text(record && record.rentalFileId);
  if (existing && existing !== rentalFileId) {
    const error = new Error(label + ' is already connected to Rental File ' + existing + '. Refusing to overwrite rental history.');
    error.code = 'woa_rental_link_conflict';
    error.rentalFileId = existing;
    throw error;
  }
}

function linkExactRecords(state, rentalFile, context = {}) {
  const linked = [];
  const exactRecords = [
    ['applications', context.application],
    ['onboardingSessions', context.session],
    ['pickupAppointments', context.appointment],
    ['contracts', context.contract],
    ['recurringPayments', context.recurring]
  ];
  exactRecords.forEach(([collection, record]) => {
    if (!record) return;
    assertCompatibleLink(record, rentalFile.id, collection + ' record ' + (recordId(record) || '(missing id)'));
    record.rentalFileId = rentalFile.id;
    const reference = sourceReference(collection, record);
    if (reference) linked.push(reference);
  });

  RENTAL_LINK_COLLECTIONS.forEach(collection => {
    rows(state, collection).forEach(record => {
      if (!record || text(record.rentalFileId) === rentalFile.id) {
        const reference = record && sourceReference(collection, record);
        if (reference) linked.push(reference);
        return;
      }
      const exactApplication = rentalFile.applicationId && text(record.applicationId) === rentalFile.applicationId;
      const exactSession = rentalFile.onboardingSessionId && text(record.onboardingSessionId) === rentalFile.onboardingSessionId;
      const exactPickup = rentalFile.pickupAppointmentId && text(record.pickupAppointmentId) === rentalFile.pickupAppointmentId;
      if (!exactApplication && !exactSession && !exactPickup) return;
      assertCompatibleLink(record, rentalFile.id, collection + ' record ' + (recordId(record) || '(missing id)'));
      record.rentalFileId = rentalFile.id;
      const reference = sourceReference(collection, record);
      if (reference) linked.push(reference);
    });
  });

  const customer = context.customer;
  const vehicle = context.vehicle;
  const onlineVehicle = context.onlineVehicle;
  if (customer) {
    const existing = text(customer.activeRentalFileId);
    if (existing && existing !== rentalFile.id) throw new Error('Customer ' + rentalFile.customerName + ' already has active Rental File ' + existing + '. End or transfer it before starting another rental.');
    customer.activeRentalFileId = rentalFile.id;
  }
  if (vehicle) {
    const existing = text(vehicle.activeRentalFileId);
    if (existing && existing !== rentalFile.id) throw new Error('Vehicle ' + rentalFile.vehicleId + ' already has active Rental File ' + existing + '. End or transfer it before another pickup.');
    vehicle.activeRentalFileId = rentalFile.id;
  }
  if (onlineVehicle) onlineVehicle.currentRentalFileId = rentalFile.id;
  return uniqueSourceReferences(linked);
}

function assertRequiredPickupContext(context = {}) {
  const required = [
    ['appointment', context.appointment],
    ['application', context.application],
    ['onboarding session', context.session],
    ['customer', context.customer],
    ['vehicle', context.vehicle],
    ['recurring payment schedule', context.recurring]
  ];
  const missing = required.filter(([, record]) => !record || !recordId(record)).map(([label]) => label);
  if (missing.length) {
    const error = new Error('Cannot create the Rental File because the exact ' + missing.join(', ') + ' record is missing.');
    error.code = 'woa_rental_source_missing';
    error.missing = missing;
    throw error;
  }
}

function upsertFromCompletedPickup(state, context = {}, actor = {}) {
  if (!state || typeof state !== 'object') throw new Error('Platform state is required to create a Rental File.');
  assertRequiredPickupContext(context);
  state.rentalFiles = rows(state, 'rentalFiles');
  const appointment = context.appointment;
  const application = context.application;
  const session = context.session;
  const customer = context.customer;
  const vehicle = context.vehicle;
  const recurring = context.recurring;
  const contract = context.contract || null;
  const onlineVehicle = context.onlineVehicle || null;
  const organizationId = text(appointment.organizationId || application.organizationId || customer.organizationId || vehicle.organizationId || 'org-wheelsonauto', 160);
  const customerId = recordId(customer);
  const vehicleId = recordId(vehicle);
  const pickupAppointmentId = recordId(appointment);
  const applicationId = recordId(application);
  const onboardingSessionId = recordId(session);
  const recurringPaymentId = recordId(recurring);
  const contractId = contract ? recordId(contract) : '';
  const startDate = text(appointment.actualPickupDate || appointment.date || session.actualPickupDate || '', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('The completed pickup must have a valid actual pickup date before a Rental File can be created.');
  const deterministicId = stableRentalFileId({ organizationId, pickupAppointmentId, applicationId, contractId, recurringPaymentId, customerId, vehicleId, startDate });
  let rentalFile = state.rentalFiles.find(record => text(record.id) === deterministicId || text(record.pickupAppointmentId) === pickupAppointmentId || text(record.applicationId) === applicationId) || null;
  const activeVehicleConflict = state.rentalFiles.find(record => record !== rentalFile && isActiveRentalFile(record) && text(record.vehicleId) === vehicleId);
  if (activeVehicleConflict) throw new Error('Vehicle ' + vehicleId + ' already belongs to active Rental File ' + activeVehicleConflict.id + '. Refusing a second active renter.');
  const activeCustomerConflict = state.rentalFiles.find(record => record !== rentalFile && isActiveRentalFile(record) && text(record.customerId) === customerId);
  if (activeCustomerConflict) throw new Error('Customer ' + (customer.name || customer.customer || customerId) + ' already belongs to active Rental File ' + activeCustomerConflict.id + '. Complete the existing return or vehicle swap first.');
  if (rentalFile && (text(rentalFile.customerId) !== customerId || text(rentalFile.vehicleId) !== vehicleId)) {
    throw new Error('Rental File ' + rentalFile.id + ' points to a different customer or vehicle. Refusing to rewrite rental history.');
  }
  const now = text(appointment.completedAt || new Date().toISOString(), 40);
  const created = !rentalFile;
  if (!rentalFile) {
    rentalFile = { id: deterministicId, createdAt: now, version: 1 };
    state.rentalFiles.unshift(rentalFile);
  }
  Object.assign(rentalFile, {
    organizationId,
    customerId,
    customerName: text(customer.name || customer.customer || appointment.customer, 240),
    customerAccountId: text(application.customerAccountId || session.customerAccountId || recurring.customerAccountId, 240),
    vehicleId,
    vehicleName: rentalVehicleName(vehicle, appointment.vehicle),
    vin: text(vehicle.vin || appointment.vin, 80),
    plate: text(vehicle.plate || vehicle.stock || appointment.plate || appointment.licensePlate, 80),
    tracker: text(vehicle.tracker, 160),
    status: 'Active',
    lifecycle: 'Active rental',
    startDate,
    actualPickupDate: startDate,
    autopayAnchorDate: text(recurring.autopayAnchorDate || appointment.autopayAnchorDate || startDate, 10),
    paymentDay: text(recurring.paymentDay || recurring.autopayWeekday || appointment.weekday, 40),
    nextChargeDate: text(recurring.nextRun || appointment.nextRecurringCharge, 40),
    weeklyAmount: Number(recurring.amount || recurring.weeklyAmount || 0),
    paymentProvider: text(recurring.paymentProvider || recurring.autopayManagedBy, 80),
    applicationId,
    onboardingSessionId,
    pickupAppointmentId,
    recurringPaymentId,
    contractId,
    onlineVehicleId: onlineVehicle ? recordId(onlineVehicle) : text(appointment.onlineVehicleId || application.onlineVehicleId, 240),
    startingMileage: Number(appointment.pickupMileage || vehicle.pickupMileage || vehicle.mileage || 0),
    createdBy: text(rentalFile.createdBy || actor.name || actor.username || actor.role || 'WheelsonAuto staff', 160),
    updatedBy: text(actor.name || actor.username || actor.role || 'WheelsonAuto staff', 160),
    updatedAt: now
  });
  rentalFile.sourceRefs = linkExactRecords(state, rentalFile, { ...context, appointment, application, session, customer, vehicle, recurring, contract, onlineVehicle });
  return { rentalFile, created, linkedCount: rentalFile.sourceRefs.length };
}

function summarize(record = {}) {
  return {
    id: text(record.id),
    organizationId: text(record.organizationId),
    customerId: text(record.customerId),
    customerName: text(record.customerName),
    vehicleId: text(record.vehicleId),
    vehicleName: text(record.vehicleName),
    vin: text(record.vin),
    plate: text(record.plate),
    tracker: text(record.tracker),
    status: text(record.status),
    startDate: text(record.startDate),
    actualPickupDate: text(record.actualPickupDate),
    endDate: text(record.endDate),
    endReason: text(record.endReason, 1200),
    startingMileage: Number(record.startingMileage || 0),
    endingMileage: Number(record.endingMileage || 0),
    weeklyAmount: Number(record.weeklyAmount || 0),
    paymentProvider: text(record.paymentProvider),
    paymentDay: text(record.paymentDay),
    nextChargeDate: text(record.nextChargeDate),
    autopayAnchorDate: text(record.autopayAnchorDate),
    customerAccountId: text(record.customerAccountId),
    applicationId: text(record.applicationId),
    pickupAppointmentId: text(record.pickupAppointmentId),
    recurringPaymentId: text(record.recurringPaymentId),
    updatedAt: text(record.updatedAt)
  };
}

function rentalForVehicleDate(state = {}, vehicleId = '', eventDate = '') {
  const normalizedVehicleId = text(vehicleId);
  const normalizedDate = text(eventDate, 10);
  if (!normalizedVehicleId || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return null;
  const matches = rows(state, 'rentalFiles').filter(record => {
    if (text(record.vehicleId) !== normalizedVehicleId) return false;
    const startDate = text(record.startDate || record.actualPickupDate, 10);
    const endDate = text(record.endDate, 10);
    return !!startDate && startDate <= normalizedDate && (!endDate || endDate >= normalizedDate);
  });
  return matches.length === 1 ? matches[0] : null;
}

function listForState(state = {}) {
  return rows(state, 'rentalFiles').map(summarize).sort((left, right) => {
    const activeOrder = Number(isActiveRentalFile(right)) - Number(isActiveRentalFile(left));
    if (activeOrder) return activeOrder;
    return Date.parse(right.updatedAt || right.startDate || 0) - Date.parse(left.updatedAt || left.startDate || 0);
  });
}

function detailForState(state = {}, rentalFileId = '') {
  const rentalFile = rows(state, 'rentalFiles').find(record => text(record.id) === text(rentalFileId));
  if (!rentalFile) return null;
  const records = {};
  RENTAL_LINK_COLLECTIONS.forEach(collection => {
    records[collection] = rows(state, collection).filter(record => text(record.rentalFileId) === rentalFile.id);
  });
  return { rentalFile: { ...rentalFile }, records };
}

function validateState(state = {}) {
  const errors = [];
  const rentalFiles = rows(state, 'rentalFiles');
  const ids = new Set();
  const activeVehicles = new Map();
  const activeCustomers = new Map();
  const customerIds = new Set(rows(state, 'customers').map(recordId).filter(Boolean));
  const vehicleIds = new Set(rows(state, 'vehicles').map(recordId).filter(Boolean));
  rentalFiles.forEach((record, index) => {
    const id = recordId(record);
    if (!id) errors.push({ code: 'rental_id_missing', index });
    else if (ids.has(id)) errors.push({ code: 'rental_id_duplicate', rentalFileId: id });
    else ids.add(id);
    if (!record.customerId || !customerIds.has(text(record.customerId))) errors.push({ code: 'rental_customer_missing', rentalFileId: id, customerId: text(record.customerId) });
    if (!record.vehicleId || !vehicleIds.has(text(record.vehicleId))) errors.push({ code: 'rental_vehicle_missing', rentalFileId: id, vehicleId: text(record.vehicleId) });
    if (!isActiveRentalFile(record)) return;
    const vehicleId = text(record.vehicleId);
    const customerId = text(record.customerId);
    if (vehicleId && activeVehicles.has(vehicleId)) errors.push({ code: 'active_vehicle_duplicate', vehicleId, rentalFileIds: [activeVehicles.get(vehicleId), id] });
    else if (vehicleId) activeVehicles.set(vehicleId, id);
    if (customerId && activeCustomers.has(customerId)) errors.push({ code: 'active_customer_duplicate', customerId, rentalFileIds: [activeCustomers.get(customerId), id] });
    else if (customerId) activeCustomers.set(customerId, id);
  });
  return { ok: errors.length === 0, count: rentalFiles.length, activeCount: rentalFiles.filter(isActiveRentalFile).length, errors };
}

function endRentalFile(state, rentalFileId = '', payload = {}, actor = {}) {
  const rentalFile = rows(state, 'rentalFiles').find(record => recordId(record) === text(rentalFileId));
  if (!rentalFile) {
    const error = new Error('Rental File was not found.');
    error.code = 'woa_rental_not_found';
    error.statusCode = 404;
    throw error;
  }
  if (!isActiveRentalFile(rentalFile)) {
    return { rentalFile, alreadyEnded: true, vehicle: rows(state, 'vehicles').find(record => recordId(record) === text(rentalFile.vehicleId)) || null };
  }
  const endDate = text(payload.endDate || new Date().toISOString().slice(0, 10), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Enter a valid return date.');
  if (rentalFile.startDate && endDate < rentalFile.startDate) throw new Error('The return date cannot be before the rental start date.');
  const endingMileage = Number(payload.endingMileage);
  if (!Number.isInteger(endingMileage) || endingMileage < Number(rentalFile.startingMileage || 0) || endingMileage > 2000000) {
    throw new Error('Enter a whole-number return mileage between the starting mileage and 2,000,000.');
  }
  const vehicle = rows(state, 'vehicles').find(record => recordId(record) === text(rentalFile.vehicleId)) || null;
  const customer = rows(state, 'customers').find(record => recordId(record) === text(rentalFile.customerId)) || null;
  if (!vehicle || !customer) throw new Error('The exact customer and vehicle must remain connected before this Rental File can be ended.');
  if (vehicle.activeRentalFileId && text(vehicle.activeRentalFileId) !== rentalFile.id) throw new Error('The vehicle now points to another active Rental File. Refusing to end the wrong rental.');
  if (customer.activeRentalFileId && text(customer.activeRentalFileId) !== rentalFile.id) throw new Error('The customer now points to another active Rental File. Refusing to end the wrong rental.');
  const allowedVehicleStatuses = ['Ready', 'Prep', 'Service'];
  const vehicleStatus = allowedVehicleStatuses.includes(text(payload.vehicleStatus, 40)) ? text(payload.vehicleStatus, 40) : 'Ready';
  const reason = text(payload.reason || 'Vehicle returned and rental ended.', 1200);
  const now = new Date().toISOString();
  Object.assign(rentalFile, {
    status: 'Returned',
    lifecycle: 'Ended rental',
    endDate,
    endedAt: now,
    endingMileage,
    endReason: reason,
    updatedAt: now,
    updatedBy: text(actor.name || actor.username || actor.role || 'WheelsonAuto staff', 160),
    version: Math.max(1, Number(rentalFile.version || 1)) + 1
  });
  Object.assign(vehicle, {
    activeRentalFileId: '',
    currentCustomer: '',
    status: vehicleStatus,
    mileage: endingMileage,
    odometer: endingMileage,
    lastReturnedAt: endDate,
    returnedAt: now,
    updatedAt: now,
    manuallyEditedAt: now
  });
  Object.assign(customer, {
    activeRentalFileId: '',
    status: 'Returned',
    stage: 'History',
    endDate,
    returnedAt: now,
    endingMileage,
    updatedAt: now
  });
  rows(state, 'recurringPayments').filter(record => text(record.rentalFileId) === rentalFile.id || recordId(record) === text(rentalFile.recurringPaymentId)).forEach(record => Object.assign(record, {
    status: 'Removed',
    tone: 'bad',
    autoChargeEnabled: false,
    autopayManagedBy: 'Stopped - Rental File ended',
    nextRun: '',
    endDate,
    endedAt: now,
    removedAt: now,
    updatedAt: now
  }));
  rows(state, 'contracts').filter(record => text(record.rentalFileId) === rentalFile.id || recordId(record) === text(rentalFile.contractId)).forEach(record => Object.assign(record, {
    status: 'Removed',
    endStatus: 'Ended',
    endDate,
    endedAt: now,
    endMileage: endingMileage,
    returnedAt: now,
    updatedAt: now
  }));
  rows(state, 'onboardingSessions').filter(record => text(record.rentalFileId) === rentalFile.id).forEach(record => Object.assign(record, { rentalStatus: 'Returned', rentalEndedAt: now, updatedAt: now }));
  rows(state, 'applications').filter(record => text(record.rentalFileId) === rentalFile.id).forEach(record => Object.assign(record, { rentalStatus: 'Returned', rentalEndedAt: now, updatedAt: now }));
  rows(state, 'onlineVehicles').filter(record => text(record.currentRentalFileId) === rentalFile.id || recordId(record) === text(rentalFile.onlineVehicleId)).forEach(record => Object.assign(record, {
    currentRentalFileId: '',
    availability: vehicleStatus === 'Ready' ? 'Available' : vehicleStatus,
    published: false,
    returnedAt: now,
    updatedAt: now
  }));
  return { rentalFile, alreadyEnded: false, vehicle, customer };
}

function archiveVehicleAssignment(state, vehicleId = '', payload = {}, actor = {}) {
  const exactVehicleId = text(vehicleId);
  const vehicle = rows(state, 'vehicles').find(record => recordId(record) === exactVehicleId) || null;
  if (!vehicle) {
    const error = new Error('Vehicle record was not found.');
    error.code = 'woa_vehicle_not_found';
    error.statusCode = 404;
    throw error;
  }
  const activeRentals = rows(state, 'rentalFiles').filter(record => isActiveRentalFile(record) && text(record.vehicleId) === exactVehicleId);
  if (activeRentals.length > 1) {
    const error = new Error('This vehicle has more than one active Rental File. Resolve the duplicate before archiving it.');
    error.code = 'woa_vehicle_rental_conflict';
    error.statusCode = 409;
    throw error;
  }
  const endDate = text(payload.endDate || new Date().toISOString().slice(0, 10), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Enter a valid archive date.');
  const reason = text(payload.reason || 'Vehicle archived from Fleet by staff.', 1200);
  const now = new Date().toISOString();
  const originalRentalFileId = text(vehicle.activeRentalFileId);
  const originalRecurringStatus = new Map(rows(state, 'recurringPayments').map(record => [record, text(record.status)]));
  const originalContractStatus = new Map(rows(state, 'contracts').map(record => [record, text([record.status, record.endStatus].join(' '))]));
  let endedRentalFile = null;
  const linkedCustomers = [];

  if (activeRentals[0]) {
    const startingMileage = Number(activeRentals[0].startingMileage || 0);
    const currentMileage = Number(vehicle.mileage || vehicle.odometer || startingMileage || 0);
    const requestedMileage = payload.endingMileage === '' || payload.endingMileage == null ? currentMileage : Number(payload.endingMileage);
    const endingMileage = Math.max(startingMileage, Number.isFinite(requestedMileage) ? Math.round(requestedMileage) : currentMileage);
    const ended = endRentalFile(state, activeRentals[0].id, { endDate, endingMileage, vehicleStatus: 'Ready', reason }, actor);
    endedRentalFile = ended.rentalFile;
    Object.assign(endedRentalFile, { status: 'Ended - vehicle archived', lifecycle: 'Ended rental', endReason: reason, updatedAt: now });
    if (ended.customer) linkedCustomers.push(ended.customer);
  } else {
    const exactCustomerId = text(vehicle.customerId);
    const exactRentalFileId = text(vehicle.activeRentalFileId);
    const directCustomers = rows(state, 'customers').filter(customer => (
      (exactCustomerId && recordId(customer) === exactCustomerId)
      || text(customer.vehicleId) === exactVehicleId
      || (exactRentalFileId && text(customer.activeRentalFileId) === exactRentalFileId)
    ));
    linkedCustomers.push(...directCustomers);
    if (!linkedCustomers.length && text(vehicle.currentCustomer)) {
      const nameMatches = rows(state, 'customers').filter(customer => (
        normalizedIdentity(customer.name || customer.customer) === normalizedIdentity(vehicle.currentCustomer)
        && !INACTIVE_RENTAL_PATTERN.test(text([customer.status, customer.stage].join(' ')))
      ));
      if (nameMatches.length === 1) linkedCustomers.push(nameMatches[0]);
      else if (nameMatches.length > 1) {
        const error = new Error('More than one active customer matches this legacy vehicle assignment. Resolve the duplicate before archiving it.');
        error.code = 'woa_vehicle_customer_conflict';
        error.statusCode = 409;
        throw error;
      }
    }
  }
  rows(state, 'customers').filter(customer => (
    text(customer.vehicleId) === exactVehicleId
    && !INACTIVE_RENTAL_PATTERN.test(text([customer.status, customer.stage].join(' ')))
  )).forEach(customer => {
    if (!linkedCustomers.includes(customer)) linkedCustomers.push(customer);
  });

  const linkedRentalFileIds = new Set([originalRentalFileId, text(activeRentals[0] && activeRentals[0].id), text(endedRentalFile && endedRentalFile.id)].filter(Boolean));
  const linkedRecurringIds = new Set([
    text(activeRentals[0] && activeRentals[0].recurringPaymentId),
    ...linkedCustomers.map(customer => text(customer.recurringPaymentId))
  ].filter(Boolean));
  const linkedContractIds = new Set([
    text(activeRentals[0] && activeRentals[0].contractId),
    ...linkedCustomers.map(customer => text(customer.contractId))
  ].filter(Boolean));
  linkedCustomers.forEach(customer => Object.assign(customer, {
    activeRentalFileId: '',
    vehicleId: '',
    vehicle: '',
    vin: '',
    licensePlate: '',
    status: 'History',
    stage: 'Vehicle archived',
    endDate,
    contractEndedAt: now,
    contractEndReason: reason,
    archivedAt: now,
    archivedBy: text(actor.name || actor.username || actor.role || 'WheelsonAuto staff', 160),
    updatedAt: now
  }));

  const exactRentalLink = record => linkedRentalFileIds.has(text(record.rentalFileId || record.activeRentalFileId));
  const stoppedRecurring = rows(state, 'recurringPayments').filter(record => (
    text(record.vehicleId) === exactVehicleId
    || exactRentalLink(record)
    || linkedRecurringIds.has(recordId(record))
  ) && !/ended|returned|closed|cancelled|canceled|history|inactive|removed|stopped|disabled/i.test(originalRecurringStatus.get(record) || ''));
  stoppedRecurring.forEach(record => Object.assign(record, {
    status: 'Stopped - vehicle archived',
    tone: 'neutral',
    autoChargeEnabled: false,
    autopayDisabled: true,
    autopayManagedBy: 'Stopped - vehicle archived',
    nextRun: 'Ended',
    endDate,
    endedAt: now,
    removedAt: now,
    updatedAt: now,
    updatedBy: text(actor.name || actor.username || actor.role || 'WheelsonAuto staff', 160)
  }));
  const endedContracts = rows(state, 'contracts').filter(record => (
    text(record.vehicleId) === exactVehicleId
    || exactRentalLink(record)
    || linkedContractIds.has(recordId(record))
  ) && !INACTIVE_RENTAL_PATTERN.test(originalContractStatus.get(record) || ''));
  endedContracts.forEach(record => Object.assign(record, {
    status: 'Ended',
    endStatus: 'Ended - vehicle archived',
    endDate,
    endedAt: now,
    endMileage: Number(vehicle.mileage || vehicle.odometer || 0) || '',
    endReason: reason,
    updatedAt: now
  }));
  Object.assign(vehicle, { activeRentalFileId: '', currentCustomer: '', customerId: '', updatedAt: now });
  return { vehicle, endedRentalFile, linkedCustomers, stoppedRecurring, endedContracts, endDate, endedAt: now, reason };
}

function completedPickupContext(state, appointment) {
  const application = rows(state, 'applications').find(record => recordId(record) === text(appointment.applicationId)) || null;
  const session = rows(state, 'onboardingSessions').find(record => recordId(record) === text(appointment.onboardingSessionId)) || null;
  const vehicle = rows(state, 'vehicles').find(record => recordId(record) === text(appointment.vehicleId)) || null;
  const onlineVehicle = rows(state, 'onlineVehicles').find(record => recordId(record) === text(appointment.onlineVehicleId)) || null;
  const recurringCandidates = rows(state, 'recurringPayments').filter(record => {
    return text(record.id) === text(application && application.recurringPaymentId)
      || text(record.pickupAppointmentId) === recordId(appointment)
      || application && text(record.applicationId) === recordId(application);
  });
  const customerCandidates = rows(state, 'customers').filter(record => {
    const exactCustomerId = text(application && application.customerId || session && session.customerId);
    if (exactCustomerId) return recordId(record) === exactCustomerId;
    return application && text(record.applicationId) === recordId(application) && text(record.vehicleId) === text(appointment.vehicleId);
  });
  const contractCandidates = rows(state, 'contracts').filter(record => application && text(record.applicationId) === recordId(application) || session && text(record.onboardingSessionId) === recordId(session));
  return {
    appointment,
    application,
    session,
    vehicle,
    onlineVehicle,
    recurring: recurringCandidates.length === 1 ? recurringCandidates[0] : null,
    customer: customerCandidates.length === 1 ? customerCandidates[0] : null,
    contract: contractCandidates.length === 1 ? contractCandidates[0] : null,
    ambiguous: {
      recurring: recurringCandidates.length,
      customer: customerCandidates.length,
      contract: contractCandidates.length
    }
  };
}

function backfillCompletedPickups(state, actor = {}) {
  state.rentalFiles = rows(state, 'rentalFiles');
  const created = [];
  const existing = [];
  const conflicts = [];
  rows(state, 'pickupAppointments').filter(appointment => appointment && appointment.completedAt && /picked up|completed/i.test(text(appointment.status))).forEach(appointment => {
    try {
      const context = completedPickupContext(state, appointment);
      const result = upsertFromCompletedPickup(state, context, actor);
      (result.created ? created : existing).push(result.rentalFile.id);
    } catch (error) {
      conflicts.push({ pickupAppointmentId: recordId(appointment), code: error.code || 'woa_rental_backfill_conflict', error: error.message });
    }
  });
  return { created, existing, conflicts, validation: validateState(state) };
}

module.exports = {
  ACTIVE_RENTAL_PATTERN,
  INACTIVE_RENTAL_PATTERN,
  RENTAL_LINK_COLLECTIONS,
  normalizedIdentity,
  stableRentalFileId,
  isActiveRentalFile,
  upsertFromCompletedPickup,
  backfillCompletedPickups,
  listForState,
  detailForState,
  rentalForVehicleDate,
  validateState,
  endRentalFile,
  archiveVehicleAssignment,
  summarize
};
