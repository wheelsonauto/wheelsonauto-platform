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

function trackerTokens(value) {
  const values = (Array.isArray(value) ? value : [value]).flatMap(item => String(item || '').split(/[,;|/\n]+/));
  return [...new Set(values.map(key).filter(Boolean))];
}

function trackerVehicleMatch(data = {}, event = {}, options = {}) {
  const organizationId = text(options.organizationId || event.organizationId || event.companyId);
  const vehicles = (data.vehicles || []).filter(vehicle => {
    if (!organizationId) return true;
    const vehicleOrganizationId = text(vehicle.organizationId || vehicle.companyId);
    return vehicleOrganizationId === organizationId || (!vehicleOrganizationId && organizationId === 'org-wheelsonauto');
  });
  const criteria = [
    {
      name: 'vehicleId',
      value: text(event.vehicleId),
      matches: vehicle => text(vehicle.id) === text(event.vehicleId)
    },
    {
      name: 'tracker',
      value: key(event.tracker || event.trackerId || event.deviceId || event.device || event.imei || event.serialNumber),
      matches: vehicle => {
        const expected = key(event.tracker || event.trackerId || event.deviceId || event.device || event.imei || event.serialNumber);
        return expected && trackerTokens([vehicle.tracker, vehicle.trackerId, vehicle.deviceId, vehicle.imei, vehicle.serialNumber]).includes(expected);
      }
    },
    {
      name: 'vin',
      value: key(event.vin),
      matches: vehicle => key(vehicle.vin) === key(event.vin)
    },
    {
      name: 'plate',
      value: key(event.plate || event.licensePlate || event.tag || event.tempTag),
      matches: vehicle => {
        const expected = key(event.plate || event.licensePlate || event.tag || event.tempTag);
        return expected && [vehicle.plate, vehicle.licensePlate, vehicle.tag, vehicle.tempTag, vehicle.stock, vehicle.oldTempTag].map(key).includes(expected);
      }
    }
  ];
  let selected = null;
  const matchedBy = [];
  for (const criterion of criteria) {
    if (!criterion.value) continue;
    const matches = vehicles.filter(criterion.matches);
    if (matches.length > 1) return { vehicle: null, matchedBy, conflict: true, reason: 'Multiple vehicles share the supplied ' + criterion.name + '.' };
    if (!matches.length) continue;
    if (selected && text(selected.id) !== text(matches[0].id)) {
      return { vehicle: null, matchedBy, conflict: true, reason: 'Tracker identifiers point to different vehicles.' };
    }
    selected = matches[0];
    matchedBy.push(criterion.name);
  }
  return selected
    ? { vehicle: selected, matchedBy, conflict: false, reason: '' }
    : { vehicle: null, matchedBy: [], conflict: false, reason: 'No exact vehicle, tracker, VIN, or tag match was found.' };
}

function trackerEventId(event = {}, organizationId = '') {
  const providerEventId = text(event.eventId || event.externalEventId || event.providerEventId || event.id);
  return providerEventId ? stableId('tracker-event', [organizationId, providerEventId]) : stableId('tracker-event', [
    organizationId,
    event.vehicleId,
    event.tracker || event.trackerId || event.deviceId || event.imei,
    event.vin,
    event.plate || event.licensePlate || event.tag,
    event.status || event.state,
    event.lastPing || event.occurredAt || event.timestamp,
    typeof event.location === 'string' ? event.location : JSON.stringify(event.location || {}),
    event.latitude || event.lat,
    event.longitude || event.lng
  ]);
}

function trackerCoordinates(event = {}) {
  const location = event.location && typeof event.location === 'object' ? event.location : {};
  const latitude = Number(event.latitude ?? event.lat ?? location.latitude ?? location.lat);
  const longitude = Number(event.longitude ?? event.lng ?? location.longitude ?? location.lng ?? location.lon);
  return {
    latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null
  };
}

function applyTrackerUpdate(data = {}, event = {}, actor = {}, options = {}) {
  data.trackerEvents = Array.isArray(data.trackerEvents) ? data.trackerEvents : [];
  data.trackerUnmatched = Array.isArray(data.trackerUnmatched) ? data.trackerUnmatched : [];
  const organizationId = text(options.organizationId || event.organizationId || event.companyId || actor.organizationId);
  const providerEventId = text(event.eventId || event.externalEventId || event.providerEventId || event.id);
  const eventId = trackerEventId(event, organizationId);
  const duplicate = data.trackerEvents.find(row => text(row.organizationId) === organizationId && (text(row.id) === eventId || (providerEventId && text(row.providerEventId) === providerEventId)));
  if (duplicate) return { duplicate: true, matched: !!duplicate.vehicleId, conflict: false, record: duplicate, vehicle: null };

  const match = trackerVehicleMatch(data, event, { organizationId });
  const now = new Date().toISOString();
  const lastPing = text(event.lastPing || event.occurredAt || event.timestamp || event.recordedAt || now);
  const provider = text(event.provider || options.provider || 'manual');
  const tracker = text(event.tracker || event.trackerId || event.deviceId || event.device || event.imei || event.serialNumber);
  const status = text(event.status || event.state || 'Active');
  const plate = text(event.plate || event.licensePlate || event.tag || event.tempTag);
  const coordinates = trackerCoordinates(event);
  const locationText = text(typeof event.location === 'string' ? event.location : event.address || event.locationLabel || (event.location && event.location.address));
  const record = {
    id: eventId,
    providerEventId: providerEventId || eventId,
    organizationId,
    provider,
    vehicleId: match.vehicle ? text(match.vehicle.id) : '',
    tracker,
    vin: text(event.vin || (match.vehicle && match.vehicle.vin)),
    plate: text(plate || (match.vehicle && (match.vehicle.plate || match.vehicle.licensePlate || match.vehicle.tag || match.vehicle.tempTag))),
    status,
    lastPing,
    receivedAt: now,
    matchedBy: match.matchedBy.join(', '),
    matchStatus: match.conflict ? 'Conflict' : (match.vehicle ? 'Matched' : 'Missing file')
  };

  if (match.vehicle) {
    const vehicle = match.vehicle;
    vehicle.tracker = text(vehicle.tracker || tracker);
    vehicle.trackerStatus = status;
    vehicle.trackerLastPing = lastPing;
    vehicle.trackerProvider = provider;
    vehicle.trackerUpdatedAt = now;
    if (locationText) vehicle.trackerLocation = locationText.slice(0, 240);
    if (coordinates.latitude !== null) vehicle.trackerLatitude = coordinates.latitude;
    if (coordinates.longitude !== null) vehicle.trackerLongitude = coordinates.longitude;
    record.customer = text(vehicle.currentCustomer || vehicle.customer || vehicle.assignedTo);
    record.vehicle = vehicleTitle(vehicle);
    if (locationText) record.location = locationText.slice(0, 240);
    if (coordinates.latitude !== null) record.latitude = coordinates.latitude;
    if (coordinates.longitude !== null) record.longitude = coordinates.longitude;
  } else {
    const missing = {
      id: stableId('tracker-missing', [organizationId, eventId]),
      eventId: providerEventId || eventId,
      organizationId,
      provider,
      tracker,
      vin: text(event.vin),
      plate,
      status,
      lastPing,
      reason: match.reason,
      matchStatus: match.conflict ? 'Conflict' : 'Missing file',
      createdAt: now
    };
    data.trackerUnmatched.unshift(missing);
    data.trackerUnmatched = data.trackerUnmatched.slice(0, 500);
  }
  data.trackerEvents.unshift(record);
  data.trackerEvents = data.trackerEvents.slice(0, 1000);
  return { duplicate: false, matched: !!match.vehicle, conflict: match.conflict, reason: match.reason, record, vehicle: match.vehicle || null };
}

function marketingPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

function marketingEmail(value) {
  const normalized = text(value).toLowerCase();
  return normalized.includes('@') ? normalized.slice(0, 240) : '';
}

function marketingLeadStatus(event = {}) {
  const raw = text(event.status || event.stage || event.lifecycleStage || event.eventType || 'New').toLowerCase();
  if (/closed|lost|unsubscribed|spam|deleted|disqualified/.test(raw)) return 'Closed';
  if (/convert|customer|won|rented|picked.?up/.test(raw)) return 'Converted';
  if (/application.?submitted|applied|submitted/.test(raw)) return 'Application submitted';
  if (/application.?started|started.?application/.test(raw)) return 'Application started';
  if (/qualified|appointment|scheduled/.test(raw)) return 'Qualified';
  if (/contacted|replied|responded|follow.?up/.test(raw)) return 'Contacted';
  return 'New';
}

function marketingOrganizationRows(rows = [], organizationId = '') {
  return rows.filter(row => {
    if (!organizationId) return true;
    const rowOrganizationId = text(row && (row.organizationId || row.companyId));
    return rowOrganizationId === organizationId || (!rowOrganizationId && organizationId === 'org-wheelsonauto');
  });
}

function uniqueMarketingMatch(rows = [], criteria = []) {
  let selected = null;
  const matchedBy = [];
  for (const criterion of criteria) {
    if (!criterion.value) continue;
    const matches = rows.filter(criterion.matches);
    if (matches.length > 1) return { record: null, conflict: true, matchedBy, reason: 'Multiple records share the supplied ' + criterion.name + '.' };
    if (!matches.length) continue;
    if (selected && text(selected.id) !== text(matches[0].id)) {
      return { record: null, conflict: true, matchedBy, reason: 'Lead identifiers point to different records.' };
    }
    selected = matches[0];
    matchedBy.push(criterion.name);
  }
  return { record: selected, conflict: false, matchedBy, reason: '' };
}

function marketingVehicleMatch(data = {}, event = {}, application = null, organizationId = '') {
  const vehicles = marketingOrganizationRows(data.vehicles || [], organizationId);
  const onlineVehicles = marketingOrganizationRows(data.onlineVehicles || [], organizationId);
  const requestedVehicleId = text(event.vehicleId);
  const requestedOnlineVehicleId = text(event.onlineVehicleId);
  const applicationVehicleId = text(application && application.vehicleId);
  const criteria = [
    {
      name: 'vehicle ID',
      value: requestedVehicleId,
      matches: vehicle => text(vehicle.id) === requestedVehicleId
    },
    {
      name: 'application vehicle ID',
      value: applicationVehicleId,
      matches: vehicle => text(vehicle.id) === applicationVehicleId
    },
    {
      name: 'VIN',
      value: key(event.vin),
      matches: vehicle => key(vehicle.vin) === key(event.vin)
    },
    {
      name: 'tag',
      value: key(event.plate || event.licensePlate || event.tag || event.tempTag),
      matches: vehicle => {
        const expected = key(event.plate || event.licensePlate || event.tag || event.tempTag);
        return expected && [vehicle.plate, vehicle.licensePlate, vehicle.tag, vehicle.tempTag, vehicle.stock, vehicle.oldTempTag].map(key).includes(expected);
      }
    }
  ];
  const matched = uniqueMarketingMatch(vehicles, criteria);
  if (matched.conflict || matched.record) return matched;
  if (requestedOnlineVehicleId || text(application && application.onlineVehicleId)) {
    const onlineId = requestedOnlineVehicleId || text(application && application.onlineVehicleId);
    const online = onlineVehicles.find(row => text(row.id) === onlineId);
    if (online && online.platformVehicleId) {
      const vehicle = vehicles.find(row => text(row.id) === text(online.platformVehicleId));
      if (vehicle) return { record: vehicle, conflict: false, matchedBy: ['online vehicle ID'], reason: '' };
    }
  }
  return { record: null, conflict: false, matchedBy: [], reason: '' };
}

function applyMarketingLead(data = {}, event = {}, actor = {}, options = {}) {
  data.websiteLeads = Array.isArray(data.websiteLeads) ? data.websiteLeads : [];
  data.marketingEvents = Array.isArray(data.marketingEvents) ? data.marketingEvents : [];
  const organizationId = text(options.organizationId || event.organizationId || event.companyId || actor.organizationId || 'org-wheelsonauto');
  const provider = text(event.provider || options.provider || 'manual').slice(0, 120) || 'manual';
  const providerEventId = text(event.eventId || event.providerEventId || event.webhookEventId || event.id).slice(0, 240);
  const externalLeadId = text(event.leadId || event.externalLeadId || event.contactId || event.prospectId).slice(0, 240);
  const occurredAt = text(event.occurredAt || event.timestamp || event.createdAt || event.date) || new Date().toISOString();
  const email = marketingEmail(event.email || event.emailAddress);
  const phone = marketingPhone(event.phone || event.phoneNumber || event.mobile);
  const suppliedName = text(event.name || event.fullName || [event.firstName, event.lastName].filter(Boolean).join(' ')).slice(0, 180);
  const eventId = providerEventId
    ? stableId('marketing-event', [organizationId, provider, providerEventId])
    : stableId('marketing-event', [organizationId, provider, externalLeadId, email, phone, event.status || event.stage, occurredAt]);
  const duplicateEvent = data.marketingEvents.find(row => text(row.id) === eventId || (providerEventId && text(row.organizationId) === organizationId && key(row.provider) === key(provider) && text(row.providerEventId) === providerEventId));
  if (duplicateEvent) {
    const duplicateLead = data.websiteLeads.find(row => text(row.id) === text(duplicateEvent.leadId));
    return { duplicate: true, created: false, conflict: false, record: duplicateLead || null, event: duplicateEvent };
  }

  const applications = marketingOrganizationRows(data.applications || [], organizationId);
  const applicationMatch = uniqueMarketingMatch(applications, [
    {
      name: 'application ID',
      value: text(event.applicationId),
      matches: row => text(row.id) === text(event.applicationId)
    },
    {
      name: 'email',
      value: email,
      matches: row => marketingEmail(row.email) === email
    },
    {
      name: 'phone',
      value: phone,
      matches: row => marketingPhone(row.phone) === phone
    }
  ]);
  const customers = marketingOrganizationRows(data.customers || [], organizationId);
  const customerMatch = uniqueMarketingMatch(customers, [
    {
      name: 'customer ID',
      value: text(event.customerId),
      matches: row => text(row.id) === text(event.customerId)
    },
    {
      name: 'customer email',
      value: email,
      matches: row => marketingEmail(row.email) === email
    },
    {
      name: 'customer phone',
      value: phone,
      matches: row => marketingPhone(row.phone) === phone
    }
  ]);
  const application = applicationMatch.record;
  const customer = customerMatch.record || (application && customers.find(row => text(row.applicationId) === text(application.id))) || null;
  const vehicleMatch = marketingVehicleMatch(data, event, application, organizationId);
  const conflict = applicationMatch.conflict || customerMatch.conflict || vehicleMatch.conflict;
  const conflictReason = [applicationMatch.reason, customerMatch.reason, vehicleMatch.reason].filter(Boolean).join(' ');
  const vehicle = conflict ? null : vehicleMatch.record;
  const missingContact = !suppliedName && !email && !phone && !application && !customer;
  const now = new Date().toISOString();
  const existing = data.websiteLeads.find(row => {
    if (text(row.organizationId || 'org-wheelsonauto') !== organizationId || key(row.provider) !== key(provider)) return false;
    if (externalLeadId && text(row.externalLeadId) === externalLeadId) return true;
    return false;
  });
  let status = marketingLeadStatus(event);
  if (customer && status !== 'Closed') status = 'Converted';
  else if (application && ['New', 'Contacted', 'Qualified', 'Application started'].includes(status)) status = 'Application submitted';
  if (conflict || missingContact) status = 'Needs review';
  const record = existing || {
    id: stableId('lead', [organizationId, provider, externalLeadId || email || phone || suppliedName, occurredAt]),
    organizationId,
    provider,
    externalLeadId,
    createdAt: occurredAt,
    providerEventIds: []
  };
  const applicationName = text(application && application.name);
  const customerName = text(customer && (customer.name || customer.customer));
  Object.assign(record, {
    organizationId,
    provider,
    externalLeadId: externalLeadId || text(record.externalLeadId),
    applicationId: conflict ? text(record.applicationId) : text(application && application.id || event.applicationId || record.applicationId),
    customerId: conflict ? text(record.customerId) : text(customer && customer.id || event.customerId || record.customerId),
    name: suppliedName || applicationName || customerName || text(record.name) || 'Lead needs review',
    phone: phone || marketingPhone(application && application.phone) || marketingPhone(customer && customer.phone) || text(record.phone),
    email: email || marketingEmail(application && application.email) || marketingEmail(customer && customer.email) || text(record.email),
    source: text(event.source || event.channel || event.referrer || record.source || provider).slice(0, 180),
    campaign: text(event.campaign || event.campaignName || record.campaign).slice(0, 180),
    adGroup: text(event.adGroup || event.adSet || event.adGroupName || record.adGroup).slice(0, 180),
    vehicleId: conflict ? text(record.vehicleId) : text(vehicle && vehicle.id || application && application.vehicleId || event.vehicleId || record.vehicleId),
    onlineVehicleId: conflict ? text(record.onlineVehicleId) : text(event.onlineVehicleId || application && application.onlineVehicleId || record.onlineVehicleId),
    vehicle: conflict ? text(record.vehicle) : text(event.vehicle || event.vehicleInterest || application && application.vehicle || vehicleTitle(vehicle || {}) || record.vehicle || 'Any vehicle'),
    vin: conflict ? text(record.vin) : text(event.vin || vehicle && vehicle.vin || record.vin),
    plate: conflict ? text(record.plate) : text(event.plate || event.licensePlate || event.tag || vehicle && (vehicle.plate || vehicle.licensePlate || vehicle.tag || vehicle.tempTag || vehicle.stock) || record.plate),
    status,
    matchStatus: conflict ? 'Conflict' : (customer ? 'Matched customer' : application ? 'Matched application' : vehicle ? 'Matched vehicle' : missingContact ? 'Needs review' : 'Lead'),
    matchReason: conflictReason || (missingContact ? 'No customer name, email, phone, or local record was supplied.' : ''),
    matchedBy: conflict ? '' : [...applicationMatch.matchedBy, ...customerMatch.matchedBy, ...vehicleMatch.matchedBy].join(', '),
    notes: text(event.notes || event.note || record.notes).slice(0, 1000),
    updatedAt: now
  });
  record.providerEventIds = [...new Set([providerEventId || eventId, ...(record.providerEventIds || [])].filter(Boolean))].slice(0, 100);
  if (!existing) data.websiteLeads.unshift(record);
  data.websiteLeads = data.websiteLeads.slice(0, 2000);
  const eventRecord = {
    id: eventId,
    providerEventId: providerEventId || eventId,
    externalLeadId,
    organizationId,
    provider,
    leadId: record.id,
    applicationId: record.applicationId || '',
    customerId: record.customerId || '',
    status: record.status,
    matchStatus: record.matchStatus,
    occurredAt,
    receivedAt: now
  };
  data.marketingEvents.unshift(eventRecord);
  data.marketingEvents = data.marketingEvents.slice(0, 1000);
  return { duplicate: false, created: !existing, conflict, reason: record.matchReason, record, event: eventRecord };
}

function verificationCaseStatus(record = {}, today = dateKey(new Date())) {
  const raw = text(record.providerStatus || record.manualDecision || record.status).toLowerCase();
  const expires = dateKey(record.expiresAt || record.expires || record.expirationDate);
  if (/cancel|closed/.test(raw)) return 'Closed';
  if (/reconnect required|customer action required/.test(raw)) return 'Customer action required';
  if (/provider failed|provider error/.test(raw)) return 'Provider failed';
  if (/reject|fail|invalid|fraud|mismatch/.test(raw)) return 'Rejected';
  if (expires && expires < today) return 'Expired';
  if (expires) {
    const expiryTime = Date.parse(expires + 'T12:00:00Z');
    const todayTime = Date.parse(today + 'T12:00:00Z');
    if (expiryTime - todayTime <= 30 * DAY_MS) return 'Expiring';
  }
  if (/verified|approved|clear|passed|active/.test(raw)) return 'Verified';
  if (/consider|review|escalated|disputed/.test(raw)) return 'Needs staff review';
  if (/provider setup|required|not connected/.test(raw)) return 'Provider setup needed';
  if (/submitted|processing|provider pending|pending provider|awaiting customer|data available/.test(raw)) return 'Provider pending';
  if (/correction|more information|resubmit/.test(raw)) return 'Correction requested';
  return 'Needs staff review';
}

function verificationCase(data, payload = {}, actor = {}) {
  const type = text(payload.type || payload.kind).toLowerCase().replace(/\s+/g, '_');
  if (!['identity', 'driver_license', 'driver_record', 'insurance', 'background'].includes(type)) throw new Error('Verification type must be identity, driver_license, driver_record, insurance, or background.');
  const customer = text(payload.customer || payload.name);
  if (!customer) throw new Error('Choose a customer before creating a verification case.');
  const profile = customerProfile(data, customer);
  const vehicle = vehicleFor(data, { ...profile, ...payload, customer });
  const provider = text(payload.provider || (type === 'insurance'
    ? process.env.WOA_INSURANCE_PROVIDER
    : type === 'background' || type === 'driver_record'
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
    carrier: type === 'insurance' ? text(payload.carrier).slice(0, 120) : '',
    insuredName: type === 'insurance' ? text(payload.insuredName || customer).slice(0, 160) : '',
    coveredVin: type === 'insurance' ? text(payload.coveredVin || payload.vin || profile.vin || vehicle.vin).slice(0, 40) : '',
    effectiveAt: type === 'insurance' ? dateKey(payload.effectiveAt || payload.effectiveDate) : '',
    coverageType: type === 'insurance' ? text(payload.coverageType).slice(0, 120) : '',
    expiresAt: dateKey(payload.expiresAt || payload.expires || payload.expirationDate),
    status: provider.toLowerCase() === 'manual' ? 'Needs staff review' : (payload.externalCaseId ? 'Provider pending' : 'Provider setup needed'),
    providerStatus: text(payload.providerStatus),
    notes: text(payload.notes),
    consentConfirmedAt: text(payload.consentConfirmedAt),
    permissiblePurposeConfirmedAt: text(payload.permissiblePurposeConfirmedAt),
    monitoringEnabled: type === 'insurance' && payload.monitoringEnabled !== false,
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
  const manualInsurance = text(record.type).toLowerCase() === 'insurance' && text(record.provider || 'manual').toLowerCase() === 'manual';
  const checklist = {
    insuredNameConfirmed: payload.insuredNameConfirmed === true,
    vehicleConfirmed: payload.vehicleConfirmed === true,
    coverageConfirmed: payload.coverageConfirmed === true,
    datesConfirmed: payload.datesConfirmed === true
  };
  if (status === 'Verified' && manualInsurance) {
    const expiresAt = dateKey(payload.expiresAt || payload.expires || record.expiresAt);
    if (!expiresAt) throw new Error('Enter the insurance expiration date before approval.');
    if (!Object.values(checklist).every(Boolean)) throw new Error('Confirm the insured name, covered vehicle/VIN, required coverage, and active policy dates before approval.');
  }
  const now = new Date().toISOString();
  record.status = status;
  record.manualDecision = status;
  record.reviewedAt = now;
  record.reviewedBy = text(actor.name || actor.username || actor.role || 'Staff');
  record.notes = text(payload.notes || record.notes);
  if (record.type === 'insurance') {
    record.carrier = text(payload.carrier || record.carrier).slice(0, 120);
    record.insuredName = text(payload.insuredName || record.insuredName || record.customer).slice(0, 160);
    record.coveredVin = text(payload.coveredVin || record.coveredVin || record.vin).slice(0, 40);
    record.effectiveAt = dateKey(payload.effectiveAt || payload.effectiveDate || record.effectiveAt);
    record.coverageType = text(payload.coverageType || record.coverageType).slice(0, 120);
    record.manualChecklist = checklist;
  }
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
  record.providerStatus = text(event.providerStatus || event.status || event.result);
  record.providerVerifiedAt = /verified|approved|clear|passed|active/i.test(record.providerStatus) ? now : record.providerVerifiedAt;
  if (event.expiresAt || event.expires || event.expirationDate) record.expiresAt = dateKey(event.expiresAt || event.expires || event.expirationDate);
  record.providerReference = text(event.reference || event.eventId || record.providerReference);
  ['providerApplicantId', 'providerInvitationId', 'providerReportId', 'providerPullId', 'providerMonitoringId', 'carrier', 'policyNumberLast4', 'customerActionUrl', 'reconnectUrl'].forEach(key => {
    if (event[key] !== undefined && event[key] !== null) record[key] = text(event[key]);
  });
  if (event.policyCount !== undefined) record.policyCount = Math.max(0, Number(event.policyCount || 0));
  if (event.isMonitored !== undefined) record.monitoringEnabled = event.isMonitored === true;
  if (Array.isArray(event.monitoredPolicySummary)) record.monitoredPolicySummary = event.monitoredPolicySummary.slice(0, 20);
  record.updatedAt = now;
  record.history = Array.isArray(record.history) ? record.history : [];
  record.history.push({ at: now, action: 'Provider update', status: record.providerStatus || 'Updated', by: text(event.provider || record.provider || 'Provider') });
  record.status = verificationCaseStatus(record);
  return record;
}

function paymentIsCollected(payment = {}) {
  const status = text(payment.status || payment.result).toLowerCase();
  if (payment.requiresVerification === true || /needs? (admin )?verification|pending (admin )?verification|awaiting (admin )?verification|under review/.test(status)) return false;
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
      reconciliationStatus: text(prior.reconciliationStatus || 'Needs review'),
      reconciledAt: text(prior.reconciledAt),
      reconciledBy: text(prior.reconciledBy),
      reconciliationNote: text(prior.reconciliationNote),
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
  (data.accountingAdjustments || []).forEach(adjustment => {
    if (/void|deleted/i.test(text(adjustment.status))) return;
    const direction = text(adjustment.direction).toLowerCase() === 'credit' ? 'credit' : 'debit';
    add('adjustment', adjustment.id, adjustment, adjustment.amount, text(adjustment.category || (direction === 'credit' ? 'Other operating income' : 'Other operating expense')), direction, adjustment.status || 'Recorded');
  });
  return entries.sort((a, b) => text(b.date).localeCompare(text(a.date)) || text(b.updatedAt).localeCompare(text(a.updatedAt)));
}

function accountingLedgerSummary(entries = [], options = {}) {
  const month = /^\d{4}-\d{2}$/.test(text(options.month)) ? text(options.month) : '';
  const filtered = (entries || []).filter(entry => !month || dateKey(entry.date || entry.createdAt).startsWith(month));
  const credits = filtered.filter(entry => entry.direction === 'credit').reduce((sum, entry) => sum + Math.abs(number(entry.amount)), 0);
  const debits = filtered.filter(entry => entry.direction === 'debit').reduce((sum, entry) => sum + Math.abs(number(entry.amount)), 0);
  const needsReview = filtered.filter(entry => !/reconciled/i.test(text(entry.reconciliationStatus)));
  const identityGaps = filtered.filter(entry => !text(entry.customer) && !/maintenance|expense|refund/i.test(text(entry.category)));
  const referenceGaps = filtered.filter(entry => !text(entry.reference));
  const byCategory = new Map();
  filtered.forEach(entry => {
    const category = text(entry.category || 'Uncategorized');
    const existing = byCategory.get(category) || { category, credits: 0, debits: 0, net: 0, count: 0 };
    const amount = Math.abs(number(entry.amount));
    if (entry.direction === 'debit') existing.debits += amount;
    else existing.credits += amount;
    existing.net = existing.credits - existing.debits;
    existing.count += 1;
    byCategory.set(category, existing);
  });
  return {
    month,
    count: filtered.length,
    credits,
    debits,
    net: credits - debits,
    needsReview: needsReview.length,
    identityGaps: identityGaps.length,
    referenceGaps: referenceGaps.length,
    readyToClose: filtered.length > 0 && needsReview.length === 0 && identityGaps.length === 0 && referenceGaps.length === 0,
    byCategory: Array.from(byCategory.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  };
}

function accountingLedgerInsights(entries = [], options = {}) {
  const month = /^\d{4}-\d{2}$/.test(text(options.month)) ? text(options.month) : '';
  const filtered = (entries || []).filter(entry => !month || dateKey(entry.date || entry.createdAt).startsWith(month));
  const summary = accountingLedgerSummary(entries, { month });
  const reconciled = filtered.filter(entry => /reconciled/i.test(text(entry.reconciliationStatus))).length;
  const missingVehicle = filtered.filter(entry => /rental|down payment|toll|claim/i.test(text(entry.category)) && !text(entry.vehicle || entry.vin || entry.plate));
  const uncategorized = filtered.filter(entry => /other operating|uncategorized/i.test(text(entry.category)));
  const references = new Map();
  filtered.forEach(entry => {
    const reference = text(entry.reference).toLowerCase();
    if (!reference) return;
    references.set(reference, (references.get(reference) || 0) + 1);
  });
  const duplicateReferences = Array.from(references.values()).filter(count => count > 1).length;
  const largestExpense = filtered.filter(entry => entry.direction === 'debit').sort((a, b) => number(b.amount) - number(a.amount))[0] || null;
  const reviewFlags = [];
  if (summary.needsReview) reviewFlags.push({ label: 'Unreconciled entries', count: summary.needsReview, level: 'warn' });
  if (summary.identityGaps) reviewFlags.push({ label: 'Customer match missing', count: summary.identityGaps, level: 'bad' });
  if (summary.referenceGaps) reviewFlags.push({ label: 'Reference missing', count: summary.referenceGaps, level: 'bad' });
  if (missingVehicle.length) reviewFlags.push({ label: 'Vehicle identity missing', count: missingVehicle.length, level: 'warn' });
  if (duplicateReferences) reviewFlags.push({ label: 'Duplicate reference review', count: duplicateReferences, level: 'warn' });
  if (uncategorized.length) reviewFlags.push({ label: 'Category review', count: uncategorized.length, level: 'warn' });
  return {
    month,
    reconciled,
    total: filtered.length,
    reviewProgress: filtered.length ? Math.round(reconciled / filtered.length * 100) : 0,
    readyToClose: summary.readyToClose,
    reviewFlags,
    largestExpense: largestExpense ? {
      amount: Math.abs(number(largestExpense.amount)),
      category: text(largestExpense.category),
      date: dateKey(largestExpense.date || largestExpense.createdAt),
      reference: text(largestExpense.reference)
    } : null
  };
}

function accountingYearSummary(entries = [], year) {
  const normalizedYear = /^\d{4}$/.test(text(year)) ? text(year) : String(new Date().getFullYear());
  const filtered = (entries || []).filter(entry => dateKey(entry.date || entry.createdAt).startsWith(normalizedYear + '-'));
  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    const key = normalizedYear + '-' + String(month).padStart(2, '0');
    months.push({ month: key, ...accountingLedgerSummary(filtered, { month: key }) });
  }
  const totals = accountingLedgerSummary(filtered);
  return {
    year: normalizedYear,
    totals,
    months,
    categories: totals.byCategory
  };
}

function accountingTaxSettings(data = {}) {
  const saved = data.accountingTaxSettings || {};
  const rawRate = Number(saved.salesTaxRate || 0);
  const rate = Number.isFinite(rawRate) ? rawRate : 0;
  const feeRate = number(saved.domesticSecurityFeeRate);
  const feeDays = Math.round(number(saved.domesticSecurityFeeMaxDays));
  return {
    state: text(saved.state || 'NJ').toUpperCase().slice(0, 2),
    salesTaxRate: rate > 0 && rate < 1 ? rate : 0.06625,
    pricesIncludeSalesTax: saved.pricesIncludeSalesTax === true,
    domesticSecurityFeeRate: feeRate > 0 && feeRate < 100 ? feeRate : 5,
    domesticSecurityFeeMaxDays: feeDays > 0 && feeDays <= 60 ? feeDays : 28,
    domesticSecurityFeeMode: ['review', 'enabled', 'disabled'].includes(text(saved.domesticSecurityFeeMode).toLowerCase()) ? text(saved.domesticSecurityFeeMode).toLowerCase() : 'review',
    updatedAt: text(saved.updatedAt),
    updatedBy: text(saved.updatedBy)
  };
}

function accountingTaxCenter(data = {}, entries = [], options = {}) {
  const settings = accountingTaxSettings(data);
  const year = /^\d{4}$/.test(text(options.year)) ? text(options.year) : String(new Date().getFullYear());
  const selectedMonth = /^\d{4}-\d{2}$/.test(text(options.month)) ? text(options.month) : year + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  const selectedQuarter = Math.max(1, Math.min(4, Number(options.quarter || Math.ceil(Number(selectedMonth.slice(5, 7)) / 3))));
  const collected = (data.payments || []).filter(paymentIsCollected).map(payment => {
    const amount = Math.abs(number(payment.amount));
    const recordedSalesTax = Math.abs(number(payment.salesTaxAmount || payment.taxAmount || payment.salesTax));
    const exempt = payment.salesTaxExempt === true || payment.taxable === false || /exempt|non.?taxable/i.test(text(payment.taxStatus || payment.taxTreatment));
    return {
      date: dateKey(payment.date || payment.paidAt || payment.createdAt),
      amount,
      recordedSalesTax,
      exempt,
      classified: payment.taxable === true || payment.taxable === false || payment.salesTaxExempt === true || recordedSalesTax > 0 || !!text(payment.taxStatus || payment.taxTreatment)
    };
  }).filter(row => row.date.startsWith(year + '-'));
  function salesFor(prefix) {
    const rows = collected.filter(row => row.date.startsWith(prefix));
    const taxableRows = rows.filter(row => !row.exempt);
    const grossReceipts = taxableRows.reduce((sum, row) => sum + row.amount, 0);
    const recordedSalesTax = taxableRows.reduce((sum, row) => sum + row.recordedSalesTax, 0);
    const estimatedSalesTax = settings.pricesIncludeSalesTax
      ? grossReceipts - grossReceipts / (1 + settings.salesTaxRate)
      : grossReceipts * settings.salesTaxRate;
    return {
      transactions: rows.length,
      grossReceipts,
      exemptReceipts: rows.filter(row => row.exempt).reduce((sum, row) => sum + row.amount, 0),
      recordedSalesTax,
      estimatedSalesTax,
      unclassifiedTransactions: rows.filter(row => !row.classified).length
    };
  }
  const agreements = (data.contracts || []).map(contract => {
    const start = dateKey(contract.rentalStartDate || contract.startDate || contract.pickupDate || contract.effectiveDate || contract.createdAt);
    const end = dateKey(contract.endDate || contract.returnDate || contract.endedAt || contract.completedAt);
    const explicitDays = Math.round(number(contract.rentalDays || contract.termDays));
    let days = explicitDays;
    if (!days && start) {
      const endDate = end || dateKey(options.asOf || new Date().toISOString());
      const startMs = Date.parse(start + 'T12:00:00Z');
      const endMs = Date.parse(endDate + 'T12:00:00Z');
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) days = Math.floor((endMs - startMs) / 86400000) + 1;
    }
    const applies = contract.domesticSecurityFeeApplies === true;
    const excluded = contract.domesticSecurityFeeApplies === false;
    const feeDays = Math.min(settings.domesticSecurityFeeMaxDays, Math.max(0, days || 0));
    const explicitFee = Math.abs(number(contract.domesticSecurityFeeAmount));
    const explicitFeeDate = dateKey(contract.domesticSecurityFeeDate || contract.domesticSecurityFeeRecordedAt);
    const feeEntries = [];
    if (explicitFee && (explicitFeeDate || start)) {
      feeEntries.push({ date: explicitFeeDate || start, amount: explicitFee, recorded: true });
    } else if (start) {
      const startMs = Date.parse(start + 'T12:00:00Z');
      for (let offset = 0; offset < feeDays; offset += 1) {
        const date = new Date(startMs + offset * 86400000).toISOString().slice(0, 10);
        feeEntries.push({ date, amount: settings.domesticSecurityFeeRate, recorded: false });
      }
    }
    return {
      id: text(contract.id),
      customer: text(contract.customer || contract.name),
      start,
      end,
      days,
      feeDays,
      applies,
      excluded,
      needsReview: !applies && !excluded,
      feeEntries,
      confirmedFee: applies && settings.domesticSecurityFeeMode !== 'disabled' ? feeEntries.reduce((sum, row) => sum + row.amount, 0) : 0,
      potentialFee: !excluded && !applies && settings.domesticSecurityFeeMode !== 'disabled' ? feeEntries.reduce((sum, row) => sum + row.amount, 0) : 0,
      classificationNotes: text(contract.domesticSecurityFeeNotes),
      classifiedAt: text(contract.domesticSecurityFeeClassifiedAt),
      classifiedBy: text(contract.domesticSecurityFeeClassifiedBy)
    };
  }).filter(row => row.feeEntries.some(entry => entry.date.startsWith(year + '-')));
  function agreementFeeForPrefixes(row, prefixes) {
    return row.feeEntries.filter(entry => prefixes.some(prefix => entry.date.startsWith(prefix))).reduce((sum, entry) => sum + entry.amount, 0);
  }
  function agreementSummaryForPrefixes(prefixes) {
    const rows = agreements.filter(row => row.feeEntries.some(entry => prefixes.some(prefix => entry.date.startsWith(prefix))));
    return {
      domesticSecurityFeeConfirmed: rows.filter(row => row.applies && settings.domesticSecurityFeeMode !== 'disabled').reduce((sum, row) => sum + agreementFeeForPrefixes(row, prefixes), 0),
      domesticSecurityFeePotential: rows.filter(row => row.needsReview && settings.domesticSecurityFeeMode !== 'disabled').reduce((sum, row) => sum + agreementFeeForPrefixes(row, prefixes), 0),
      agreementsNeedingClassification: rows.filter(row => row.needsReview).length
    };
  }
  function quarterPrefix(quarter) {
    const startMonth = (quarter - 1) * 3 + 1;
    return [0, 1, 2].map(offset => year + '-' + String(startMonth + offset).padStart(2, '0'));
  }
  function quarterSummary(quarter) {
    const prefixes = quarterPrefix(quarter);
    const sales = prefixes.map(prefix => salesFor(prefix)).reduce((total, row) => ({
      transactions: total.transactions + row.transactions,
      grossReceipts: total.grossReceipts + row.grossReceipts,
      exemptReceipts: total.exemptReceipts + row.exemptReceipts,
      recordedSalesTax: total.recordedSalesTax + row.recordedSalesTax,
      estimatedSalesTax: total.estimatedSalesTax + row.estimatedSalesTax,
      unclassifiedTransactions: total.unclassifiedTransactions + row.unclassifiedTransactions
    }), { transactions: 0, grossReceipts: 0, exemptReceipts: 0, recordedSalesTax: 0, estimatedSalesTax: 0, unclassifiedTransactions: 0 });
    const feeSummary = agreementSummaryForPrefixes(prefixes);
    return {
      quarter,
      label: 'Q' + quarter + ' ' + year,
      ...sales,
      ...feeSummary
    };
  }
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = year + '-' + String(index + 1).padStart(2, '0');
    return { month, ...salesFor(month), ...agreementSummaryForPrefixes([month]) };
  });
  const quarterly = [1, 2, 3, 4].map(quarterSummary);
  const yearSales = monthly.reduce((total, row) => ({
    transactions: total.transactions + row.transactions,
    grossReceipts: total.grossReceipts + row.grossReceipts,
    exemptReceipts: total.exemptReceipts + row.exemptReceipts,
    recordedSalesTax: total.recordedSalesTax + row.recordedSalesTax,
    estimatedSalesTax: total.estimatedSalesTax + row.estimatedSalesTax,
    unclassifiedTransactions: total.unclassifiedTransactions + row.unclassifiedTransactions
  }), { transactions: 0, grossReceipts: 0, exemptReceipts: 0, recordedSalesTax: 0, estimatedSalesTax: 0, unclassifiedTransactions: 0 });
  return {
    year,
    selectedMonth,
    selectedQuarter,
    settings,
    month: monthly.find(row => row.month === selectedMonth) || { month: selectedMonth },
    quarter: quarterly[selectedQuarter - 1],
    yearly: {
      ...yearSales,
      netBooks: accountingYearSummary(entries, year).totals.net,
      domesticSecurityFeeConfirmed: agreements.reduce((sum, row) => sum + row.confirmedFee, 0),
      domesticSecurityFeePotential: agreements.reduce((sum, row) => sum + row.potentialFee, 0),
      agreementsNeedingClassification: agreements.filter(row => row.needsReview).length
    },
    monthly,
    quarterly,
    agreements,
    guidance: 'The New Jersey Domestic Security Fee is based on rental-agreement days, not whether the customer physically drove. WheelsonAuto keeps unclassified agreements in review until the owner or tax professional confirms their treatment.'
  };
}

function accountingPeriodSnapshot(entries = [], month, actor = {}) {
  if (!/^\d{4}-\d{2}$/.test(text(month))) throw new Error('Choose a valid accounting month.');
  const summary = accountingLedgerSummary(entries, { month });
  if (!summary.count) throw new Error('That month has no accounting entries to close.');
  const now = new Date().toISOString();
  const sourceKeys = entries.filter(entry => dateKey(entry.date || entry.createdAt).startsWith(month)).map(entry => text(entry.sourceKey)).sort();
  return {
    id: stableId('accounting-period', [month]),
    month,
    status: 'Closed',
    entryCount: summary.count,
    credits: summary.credits,
    debits: summary.debits,
    net: summary.net,
    unresolvedAtClose: summary.needsReview + summary.identityGaps + summary.referenceGaps,
    sourceHash: crypto.createHash('sha256').update(sourceKeys.join('|')).digest('hex'),
    closedAt: now,
    closedBy: text(actor.name || actor.username || actor.role || 'Owner')
  };
}

function reconcileAccountingEntry(entry, payload = {}, actor = {}) {
  if (!entry) throw new Error('Accounting entry was not found.');
  const decision = text(payload.status || payload.decision).toLowerCase();
  if (!['reconciled', 'needs_review', 'needs review'].includes(decision)) throw new Error('Choose reconciled or needs review.');
  const now = new Date().toISOString();
  entry.reconciliationStatus = decision === 'reconciled' ? 'Reconciled' : 'Needs review';
  entry.reconciledAt = decision === 'reconciled' ? now : '';
  entry.reconciledBy = decision === 'reconciled' ? text(actor.name || actor.username || actor.role || 'Owner') : '';
  entry.reconciliationNote = text(payload.notes || payload.note);
  entry.updatedAt = now;
  return entry;
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
  trackerTokens,
  trackerVehicleMatch,
  applyTrackerUpdate,
  marketingLeadStatus,
  applyMarketingLead,
  verificationCaseStatus,
  verificationCase,
  reviewVerificationCase,
  applyVerificationEvent,
  buildAccountingLedger,
  accountingLedgerSummary,
  accountingLedgerInsights,
  accountingYearSummary,
  accountingTaxSettings,
  accountingTaxCenter,
  accountingPeriodSnapshot,
  reconcileAccountingEntry,
  buildQuickBooksJournalRows,
  pickupCalendarEvent,
  buildPickupCalendarEvents
};
