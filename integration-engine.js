const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function key(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function dateKey(value) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function stableId(prefix, parts) {
  const fingerprint = parts.map(text).join('|');
  return prefix + '-' + crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
}

function customerProfile(data, customer) {
  const customerKey = key(customer);
  if (!customerKey) return {};
  const rows = []
    .concat(data.customers || [])
    .concat(data.contracts || [])
    .concat(data.recurringPayments || [])
    .concat((((data.integrations || {}).clover || {}).recurringPlanMembers) || []);
  return rows.find(row => key(row.customer || row.name) === customerKey) || {};
}

function vehicleFor(data, row = {}) {
  const vehicles = data.vehicles || [];
  if (row.vehicleId) {
    const byId = vehicles.find(vehicle => text(vehicle.id) === text(row.vehicleId));
    if (byId) return byId;
  }
  if (row.vin) {
    const byVin = vehicles.find(vehicle => key(vehicle.vin) === key(row.vin));
    if (byVin) return byVin;
  }
  const plate = key(row.plate || row.licensePlate || row.tag || row.tempTag);
  if (plate) {
    const byPlate = vehicles.find(vehicle => [vehicle.plate, vehicle.stock, vehicle.tempTag, vehicle.licensePlate].map(key).includes(plate));
    if (byPlate) return byPlate;
  }
  const customerKey = key(row.customer || row.name);
  if (customerKey) return vehicles.find(vehicle => key(vehicle.currentCustomer || vehicle.customer || vehicle.assignedTo) === customerKey) || {};
  return {};
}

function vehicleTitle(vehicle = {}) {
  return text(vehicle.name || [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(' '));
}

function verificationCaseStatus(record = {}, today = dateKey(new Date())) {
  const raw = text(record.providerStatus || record.manualDecision || record.status).toLowerCase();
  const expires = dateKey(record.expiresAt || record.expires || record.expirationDate);
  if (/cancel|closed/.test(raw)) return 'Closed';
  if (/reject|fail|invalid|fraud|mismatch/.test(raw)) return 'Rejected';
  if (expires && expires < today) return 'Expired';
  if (expires) {
    const expiryTime = Date.parse(expires + 'T12:00:00Z');
    const todayTime = Date.parse(today + 'T12:00:00Z');
    if (expiryTime - todayTime <= 30 * DAY_MS) return 'Expiring';
  }
  if (/verified|approved|clear|passed|active/.test(raw)) return 'Verified';
  if (/provider setup|required|not connected/.test(raw)) return 'Provider setup needed';
  if (/submitted|processing|provider pending|pending provider/.test(raw)) return 'Provider pending';
  if (/correction|more information|resubmit/.test(raw)) return 'Correction requested';
  return 'Needs staff review';
}

function verificationCase(data, payload = {}, actor = {}) {
  const type = text(payload.type || payload.kind).toLowerCase().replace(/\s+/g, '_');
  if (!['identity', 'driver_license', 'insurance', 'background'].includes(type)) throw new Error('Verification type must be identity, driver_license, insurance, or background.');
  const customer = text(payload.customer || payload.name);
  if (!customer) throw new Error('Choose a customer before creating a verification case.');
  const profile = customerProfile(data, customer);
  const vehicle = vehicleFor(data, { ...profile, ...payload, customer });
  const provider = text(payload.provider || (type === 'insurance'
    ? process.env.WOA_INSURANCE_PROVIDER
    : type === 'background'
      ? process.env.WOA_BACKGROUND_PROVIDER
      : process.env.WOA_IDENTITY_PROVIDER) || 'manual');
  const now = new Date().toISOString();
  const reference = text(payload.reference || payload.policyNumber || payload.driverLicenseId);
  const dedupeKey = stableId('verification', [type, customer, payload.documentId, payload.onboardingSessionId, payload.externalCaseId, reference.slice(-4)]);
  const existing = (data.verificationCases || []).find(row => row.dedupeKey === dedupeKey && !/closed|rejected|expired/i.test(text(row.status)));
  if (existing) return { record: existing, created: false };
  const record = {
    id: stableId('verify', [dedupeKey, now]),
    dedupeKey,
    type,
    customer,
    phone: text(payload.phone || profile.phone),
    email: text(payload.email || profile.email),
    vehicleId: text(payload.vehicleId || profile.vehicleId || vehicle.id),
    vehicle: text(payload.vehicle || profile.vehicle || vehicleTitle(vehicle)),
    vin: text(payload.vin || profile.vin || vehicle.vin),
    plate: text(payload.plate || payload.licensePlate || profile.plate || profile.licensePlate || vehicle.plate || vehicle.stock),
    tracker: text(payload.tracker || profile.tracker || vehicle.tracker),
    provider,
    externalCaseId: text(payload.externalCaseId || payload.providerCaseId),
    documentId: text(payload.documentId),
    onboardingSessionId: text(payload.onboardingSessionId),
    policyNumberLast4: type === 'insurance' ? reference.slice(-4) : '',
    referenceLast4: type !== 'insurance' ? reference.slice(-4) : '',
    expiresAt: dateKey(payload.expiresAt || payload.expires || payload.expirationDate),
    status: provider.toLowerCase() === 'manual' ? 'Needs staff review' : (payload.externalCaseId ? 'Provider pending' : 'Provider setup needed'),
    providerStatus: text(payload.providerStatus),
    notes: text(payload.notes),
    createdAt: now,
    createdBy: text(actor.name || actor.username || actor.role || 'Staff'),
    history: [{ at: now, action: 'Case created', status: provider.toLowerCase() === 'manual' ? 'Needs staff review' : (payload.externalCaseId ? 'Provider pending' : 'Provider setup needed'), by: text(actor.name || actor.role || 'Staff') }]
  };
  record.status = verificationCaseStatus(record);
  return { record, created: true };
}

function reviewVerificationCase(record, payload = {}, actor = {}) {
  if (!record) throw new Error('Verification case was not found.');
  const decision = text(payload.decision || payload.status).toLowerCase();
  const statuses = {
    approve: 'Verified',
    verified: 'Verified',
    reject: 'Rejected',
    rejected: 'Rejected',
    correction: 'Correction requested',
    request_correction: 'Correction requested',
    close: 'Closed'
  };
  const status = statuses[decision];
  if (!status) throw new Error('Choose approve, reject, request_correction, or close.');
  const now = new Date().toISOString();
  record.status = status;
  record.manualDecision = status;
  record.reviewedAt = now;
  record.reviewedBy = text(actor.name || actor.username || actor.role || 'Staff');
  record.notes = text(payload.notes || record.notes);
  if (payload.expiresAt || payload.expires) record.expiresAt = dateKey(payload.expiresAt || payload.expires);
  record.history = Array.isArray(record.history) ? record.history : [];
  record.history.push({ at: now, action: 'Staff review', status, by: record.reviewedBy, notes: text(payload.notes) });
  record.status = verificationCaseStatus(record);
  return record;
}

function applyVerificationEvent(record, event = {}) {
  if (!record) throw new Error('Verification case was not found.');
  const now = new Date().toISOString();
  record.externalCaseId = text(event.externalCaseId || event.providerCaseId || event.id || record.externalCaseId);
  record.providerStatus = text(event.status || event.providerStatus || event.result);
  record.providerVerifiedAt = /verified|approved|clear|passed|active/i.test(record.providerStatus) ? now : record.providerVerifiedAt;
  if (event.expiresAt || event.expires || event.expirationDate) record.expiresAt = dateKey(event.expiresAt || event.expires || event.expirationDate);
  record.providerReference = text(event.reference || event.eventId || record.providerReference);
  record.updatedAt = now;
  record.history = Array.isArray(record.history) ? record.history : [];
  record.history.push({ at: now, action: 'Provider update', status: record.providerStatus || 'Updated', by: text(event.provider || record.provider || 'Provider') });
  record.status = verificationCaseStatus(record);
  return record;
}

function paymentIsCollected(payment = {}) {
  const status = text(payment.status || payment.result).toLowerCase();
  if (/fail|declin|void|cancel|not found|pending/.test(status)) return false;
  return /paid|approved|succeed|complete|captured|collected/.test(status) || (!!payment.cloverPaymentId && !status);
}

function ledgerCategory(row = {}) {
  const source = text([row.paymentType, row.type, row.reason, row.notes, row.source].filter(Boolean).join(' ')).toLowerCase();
  if (/down payment|deposit/.test(source)) return 'Nonrefundable down payment';
  if (/toll|violation|ticket/.test(source)) return 'Toll / violation recovery';
  if (/claim|damage|reimbursement/.test(source)) return 'Claim recovery';
  if (/refund/.test(source)) return 'Customer refund';
  return 'Rental payment';
}

function ledgerIdentity(data, row = {}) {
  const customer = text(row.customer || row.name);
  const profile = customerProfile(data, customer);
  const vehicle = vehicleFor(data, { ...profile, ...row, customer });
  return {
    customer,
    customerId: text(row.customerId || profile.id),
    vehicleId: text(row.vehicleId || profile.vehicleId || vehicle.id),
    vehicle: text(row.vehicle || profile.vehicle || vehicleTitle(vehicle)),
    vin: text(row.vin || profile.vin || vehicle.vin),
    plate: text(row.plate || row.licensePlate || profile.plate || profile.licensePlate || vehicle.plate || vehicle.stock),
    tracker: text(row.tracker || profile.tracker || vehicle.tracker)
  };
}

function buildAccountingLedger(data = {}, existing = []) {
  const syncByKey = new Map((existing || []).map(row => [text(row.sourceKey), row]));
  const entries = [];
  const seen = new Set();
  function add(sourceType, sourceId, row, amount, category, direction, status) {
    amount = number(amount);
    if (!sourceId || !amount) return;
    const sourceKey = sourceType + ':' + sourceId;
    if (seen.has(sourceKey)) return;
    seen.add(sourceKey);
    const identity = ledgerIdentity(data, row);
    const prior = syncByKey.get(sourceKey) || {};
    entries.push({
      id: stableId('ledger', [sourceKey]),
      sourceKey,
      sourceType,
      sourceId: text(sourceId),
      date: dateKey(row.date || row.createdAt || row.paidAt || row.updatedAt),
      amount: Math.abs(amount),
      signedAmount: direction === 'debit' ? -Math.abs(amount) : Math.abs(amount),
      direction,
      category,
      status: text(status || row.status || 'Recorded'),
      method: text(row.method || row.tender || row.paymentProvider || row.provider || row.source),
      reference: text(row.cloverPaymentId || row.providerPaymentId || row.externalReferenceId || row.reference || sourceId),
      companyId: text(row.organizationId || row.companyId || identity.companyId),
      ...identity,
      notes: text(row.notes || row.reason || row.issue),
      quickBooksStatus: text(prior.quickBooksStatus || 'Not synced'),
      quickBooksEntityId: text(prior.quickBooksEntityId),
      quickBooksSyncedAt: text(prior.quickBooksSyncedAt),
      createdAt: text(prior.createdAt || row.createdAt || new Date().toISOString()),
      updatedAt: new Date().toISOString()
    });
  }
  (data.payments || []).forEach(payment => {
    if (!paymentIsCollected(payment)) return;
    const id = payment.id || payment.cloverPaymentId || payment.providerPaymentId;
    add('payment', id, payment, payment.amount, ledgerCategory(payment), 'credit', payment.status || 'Paid');
  });
  (data.refundRequests || []).forEach(refund => {
    if (!/succeed|complete|refunded|manual complete/i.test(text(refund.status))) return;
    add('refund', refund.id || refund.providerRefundId, refund, refund.amount, 'Customer refund', 'debit', refund.status);
  });
  (data.maintenance || []).forEach(job => {
    if (!number(job.cost)) return;
    add('maintenance', job.id, job, job.cost, 'Maintenance / repair', 'debit', job.status || 'Logged');
  });
  (data.claims || []).forEach(claim => {
    if (!/paid|recovered|complete|closed/i.test(text(claim.status)) || !number(claim.paidAmount || claim.amount)) return;
    add('claim', claim.id, claim, claim.paidAmount || claim.amount, ledgerCategory(claim), 'credit', claim.status);
  });
  return entries.sort((a, b) => text(b.date).localeCompare(text(a.date)) || text(b.updatedAt).localeCompare(text(a.updatedAt)));
}

function quickBooksOffsetAccount(entry = {}) {
  const method = text([entry.method, entry.reference].filter(Boolean).join(' ')).toLowerCase();
  if (/clover/.test(method)) return 'Clover Clearing';
  if (/cash/.test(method)) return 'Cash on Hand';
  if (/check|ach|bank|transfer/.test(method)) return 'Operating Bank';
  return entry.direction === 'debit' ? 'Operating Bank' : 'Undeposited Funds';
}

function quickBooksCategoryAccount(entry = {}) {
  const category = text(entry.category).toLowerCase();
  if (/nonrefundable down payment|deposit/.test(category)) return 'Down Payment Income';
  if (/toll|violation|ticket/.test(category)) return 'Toll and Violation Reimbursements';
  if (/claim recovery/.test(category)) return 'Claim Recoveries';
  if (/customer refund|refund/.test(category)) return 'Customer Refunds and Allowances';
  if (/maintenance|repair/.test(category)) return 'Repairs and Maintenance';
  if (/rental payment/.test(category)) return 'Rental Income';
  return entry.direction === 'debit' ? 'Other Operating Expense' : 'Other Operating Income';
}

function buildQuickBooksJournalRows(entries = []) {
  return (entries || []).flatMap(entry => {
    const amount = Math.abs(number(entry.amount));
    if (!amount || !entry.sourceKey) return [];
    const journalNo = 'WOA-' + stableId('journal', [entry.sourceKey]).slice(-12).toUpperCase();
    const offsetAccount = quickBooksOffsetAccount(entry);
    const categoryAccount = quickBooksCategoryAccount(entry);
    const description = [entry.category, entry.vehicle, entry.vin ? 'VIN ' + entry.vin : '', entry.plate ? 'Tag ' + entry.plate : ''].filter(Boolean).join(' | ');
    const common = {
      journalNo,
      journalDate: dateKey(entry.date || entry.createdAt),
      description,
      name: text(entry.customer),
      className: 'WheelsonAuto Fleet',
      location: text(entry.companyId),
      reference: text(entry.reference),
      sourceKey: text(entry.sourceKey)
    };
    const debitAccount = entry.direction === 'debit' ? categoryAccount : offsetAccount;
    const creditAccount = entry.direction === 'debit' ? offsetAccount : categoryAccount;
    return [
      { ...common, lineNo: 1, account: debitAccount, debit: amount, credit: 0 },
      { ...common, lineNo: 2, account: creditAccount, debit: 0, credit: amount }
    ];
  });
}

function parseTime(value) {
  const raw = text(value).toUpperCase();
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/.exec(raw);
  if (!match) return { hour: 11, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3] === 'PM' && hour < 12) hour += 12;
  if (match[3] === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function compactCalendarDate(date, time, durationMinutes) {
  const rawDate = dateKey(date).replace(/-/g, '');
  const parsed = parseTime(time);
  const start = new Date(Date.UTC(Number(rawDate.slice(0, 4)), Number(rawDate.slice(4, 6)) - 1, Number(rawDate.slice(6, 8)), parsed.hour, parsed.minute));
  const end = new Date(start.getTime() + Math.max(15, Number(durationMinutes || 60)) * 60000);
  const format = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const localEnd = format(end);
  return { start: format(start), end: localEnd, localEnd, day: rawDate, hour: String(parsed.hour).padStart(2, '0'), minute: String(parsed.minute).padStart(2, '0') };
}

function icsEscape(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function pickupCalendarEvent(appointment = {}, settings = {}) {
  const address = text(appointment.address || settings.pickupAddress || '5150 NJ-42, Blackwood, NJ 08012');
  const title = 'WheelsonAuto pickup - ' + text(appointment.customer || 'Customer');
  const details = compactCalendarDate(appointment.date, appointment.time, appointment.durationMinutes || settings.pickupSlotMinutes || 60);
  const description = [
    text(appointment.vehicle),
    appointment.vin ? 'VIN ' + text(appointment.vin) : '',
    appointment.plate ? 'Tag ' + text(appointment.plate) : '',
    appointment.phone ? 'Customer phone ' + text(appointment.phone) : '',
    'Pickup date becomes the weekly autopay weekday after onboarding is completed.'
  ].filter(Boolean).join('\n');
  const uid = stableId('pickup', [appointment.id || '', appointment.date, appointment.time, appointment.customer]) + '@wheelsonauto.com';
  const googleParams = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: details.start + '/' + details.end,
    details: description,
    location: address,
    ctz: 'America/New_York'
  });
  const mapsParams = new URLSearchParams({ api: '1', destination: address });
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WheelsonAuto//Pickup Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + icsEscape(uid),
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),
    'DTSTART;TZID=America/New_York:' + details.day + 'T' + details.hour + details.minute + '00',
    'DTEND;TZID=America/New_York:' + details.localEnd,
    'SUMMARY:' + icsEscape(title),
    'DESCRIPTION:' + icsEscape(description),
    'LOCATION:' + icsEscape(address),
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
  return {
    id: stableId('calendar', [appointment.id || uid]),
    appointmentId: text(appointment.id),
    uid,
    title,
    description,
    address,
    date: dateKey(appointment.date),
    time: text(appointment.time),
    durationMinutes: Math.max(15, Number(appointment.durationMinutes || settings.pickupSlotMinutes || 60)),
    googleCalendarUrl: 'https://calendar.google.com/calendar/render?' + googleParams.toString(),
    mapsUrl: 'https://www.google.com/maps/dir/?' + mapsParams.toString(),
    ics
  };
}

function buildPickupCalendarEvents(data = {}) {
  return (data.pickupAppointments || []).filter(row => !/cancel/i.test(text(row.status))).map(row => pickupCalendarEvent(row, data.publicSite || {}));
}

module.exports = {
  stableId,
  dateKey,
  verificationCaseStatus,
  verificationCase,
  reviewVerificationCase,
  applyVerificationEvent,
  buildAccountingLedger,
  buildQuickBooksJournalRows,
  pickupCalendarEvent,
  buildPickupCalendarEvents
};
