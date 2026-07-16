const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const nativeSite = require('./native-site');

function text(value, max = 500) {
  return String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function dateDisplay(value) {
  const raw = String(value || '').slice(0, 10);
  const parts = raw.split('-');
  return parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) + '/' + parts[0] : raw;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function ensureCollections(data = {}) {
  data.onlineVehicles = Array.isArray(data.onlineVehicles) ? data.onlineVehicles : [];
  data.onboardingSessions = Array.isArray(data.onboardingSessions) ? data.onboardingSessions : [];
  data.eSignatures = Array.isArray(data.eSignatures) ? data.eSignatures : [];
  data.pickupAppointments = Array.isArray(data.pickupAppointments) ? data.pickupAppointments : [];
  data.documents = Array.isArray(data.documents) ? data.documents : [];
  data.contractTemplates = Array.isArray(data.contractTemplates) ? data.contractTemplates : [];
  data.paymentRequests = Array.isArray(data.paymentRequests) ? data.paymentRequests : [];
  data.cardSetupRequests = Array.isArray(data.cardSetupRequests) ? data.cardSetupRequests : [];
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  data.customerAccounts = Array.isArray(data.customerAccounts) ? data.customerAccounts : [];
  return data;
}

async function activeContractTemplate(data, templateFile) {
  ensureCollections(data);
  const saved = data.contractTemplates.filter(template => template && template.body).sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
  if (saved) return { ...saved, hash: saved.hash || nativeSite.contractTemplateHash(saved.body) };
  const body = await fs.readFile(templateFile, 'utf8');
  return {
    id: 'woa-nj-long-term-v1',
    name: 'New Jersey long-term rental with optional purchase',
    version: 1,
    status: 'Active',
    body,
    hash: nativeSite.contractTemplateHash(body),
    source: 'Owner-provided agreement',
    createdAt: new Date().toISOString()
  };
}

function findPublicVehicle(data, idOrSlug) {
  const wanted = String(idOrSlug || '');
  return (data.onlineVehicles || []).find(vehicle => vehicle.id === wanted || nativeSite.publicVehicleSlug(vehicle) === wanted) || null;
}

function pricingSnapshot(vehicle = {}) {
  return {
    onlineVehicleId: vehicle.id || '',
    vehicleTitle: nativeSite.vehicleTitle(vehicle),
    weeklyPayment: Number(vehicle.weeklyPayment || 0),
    downPayment: Number(vehicle.downPayment || 0),
    optionalPurchasePrice: Number(vehicle.optionalPurchasePrice || 0),
    dailyMileageAllowance: Number(vehicle.dailyMileageAllowance || 0),
    excessMileageRate: Number(vehicle.excessMileageRate || 0),
    contractMonths: nativeSite.CONTRACT_MONTHS,
    capturedAt: new Date().toISOString()
  };
}

function createSession(data, application, actor, baseUrl) {
  ensureCollections(data);
  const rawToken = crypto.randomBytes(28).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 86400000);
  const old = data.onboardingSessions.find(session => session.applicationId === application.id && !/completed|cancelled|expired/i.test(String(session.status || '')));
  if (old) {
    old.status = 'Replaced';
    old.replacedAt = now.toISOString();
  }
  const session = {
    id: 'onboard-' + crypto.randomBytes(8).toString('hex'),
    applicationId: application.id,
    onlineVehicleId: application.onlineVehicleId || application.vehicleId || '',
    organizationId: application.organizationId || 'org-wheelsonauto',
    tokenHash: tokenHash(rawToken),
    status: 'Open',
    documentReviewStatus: 'Waiting on customer',
    signatureReviewStatus: 'Waiting on customer',
    reviewStatus: 'Waiting on customer',
    createdAt: now.toISOString(),
    createdBy: actor && (actor.name || actor.username || actor.role) || 'WheelsonAuto',
    expiresAt: expires.toISOString(),
    linkCreatedAt: now.toISOString()
  };
  Object.defineProperty(session, 'publicToken', { value: rawToken, enumerable: false, configurable: true });
  Object.defineProperty(session, 'publicUrl', { value: baseUrl.replace(/\/+$/, '') + '/onboard/' + rawToken, enumerable: false, configurable: true });
  data.onboardingSessions.unshift(session);
  application.onboardingSessionId = session.id;
  application.onboardingStatus = 'Link ready';
  application.onboardingLinkCreatedAt = session.createdAt;
  application.updatedAt = session.createdAt;
  return session;
}

function findSession(data, publicToken) {
  ensureCollections(data);
  const hash = tokenHash(publicToken);
  const session = data.onboardingSessions.find(item => item.tokenHash === hash && !/replaced|cancelled/i.test(String(item.status || '')));
  if (!session) return null;
  if (Date.parse(session.expiresAt || '') < Date.now()) {
    session.status = 'Expired';
    return null;
  }
  Object.defineProperty(session, 'publicToken', { value: String(publicToken || ''), enumerable: false, configurable: true });
  return session;
}

function releaseExpiredHolds(data, nowValue = Date.now()) {
  ensureCollections(data);
  const now = Number(nowValue) || Date.now();
  const terminal = /completed|cancelled|expired|replaced|pickup confirmed/i;
  const expired = [];
  data.onboardingSessions.forEach(session => {
    const expiresAt = Date.parse(session.expiresAt || '');
    if (!terminal.test(String(session.status || '')) && Number.isFinite(expiresAt) && expiresAt < now) {
      session.status = 'Expired';
      session.expiredAt = new Date(now).toISOString();
      expired.push(session);
    }
  });
  let released = 0;
  expired.forEach(session => {
    const otherActive = data.onboardingSessions.some(candidate => candidate.id !== session.id && candidate.onlineVehicleId === session.onlineVehicleId && !terminal.test(String(candidate.status || '')) && (!candidate.expiresAt || Date.parse(candidate.expiresAt) >= now));
    if (otherActive) return;
    const application = applicationForSession(data, session);
    if (application) {
      application.status = 'Onboarding expired - reapprove if still interested';
      application.stage = 'Review';
      application.onboardingStatus = 'Expired';
      application.updatedAt = new Date(now).toISOString();
    }
    const vehicle = findPublicVehicle(data, session.onlineVehicleId);
    if (!vehicle || vehicle.heldApplicationId && vehicle.heldApplicationId !== session.applicationId) return;
    vehicle.published = true;
    vehicle.availability = 'Available';
    vehicle.heldFor = '';
    vehicle.heldApplicationId = '';
    vehicle.heldUntil = '';
    vehicle.updatedAt = new Date(now).toISOString();
    const linked = (data.vehicles || []).find(row => row.id === vehicle.platformVehicleId);
    if (linked && (!linked.heldApplicationId || linked.heldApplicationId === session.applicationId) && /pending application|held for onboarding/i.test(String(linked.status || ''))) {
      linked.status = linked.holdPreviousStatus || 'Ready';
      linked.heldFor = '';
      linked.heldApplicationId = '';
      linked.heldUntil = '';
      linked.holdPreviousStatus = '';
      linked.updatedAt = new Date(now).toISOString();
    }
    released += 1;
  });
  return { expired: expired.length, released };
}

function sessionPublicUrl(session, baseUrl) {
  if (!session || !session.publicToken) return '';
  return String(baseUrl || '').replace(/\/+$/, '') + '/onboard/' + session.publicToken;
}

function applicationForSession(data, session) {
  return (data.applications || []).find(application => application.id === session.applicationId) || null;
}

function contractValues(data, application, vehicle, session, extra = {}) {
  const linked = (data.vehicles || []).find(item => item.id === vehicle.platformVehicleId) || {};
  const pricing = application.pricingSnapshot || pricingSnapshot(vehicle);
  const address = [application.address, application.city, application.state, application.postalCode].filter(Boolean).join(', ');
  return {
    EFFECTIVE_DATE: dateDisplay(extra.signedAt || new Date().toISOString()),
    RENTER_NAME: application.name || '',
    DRIVER_LICENSE_ID: application.driverLicenseId || '',
    RENTER_ADDRESS: address,
    VEHICLE_YEAR: vehicle.year || linked.year || '',
    VEHICLE_MAKE: vehicle.make || linked.make || '',
    VEHICLE_MODEL: vehicle.model || linked.model || '',
    VEHICLE_VIN: vehicle.vin || linked.vin || '',
    VEHICLE_PLATE: vehicle.plate || linked.plate || linked.stock || '',
    START_ODOMETER: vehicle.mileage || linked.mileage || linked.odometer || '',
    DAILY_MILEAGE_ALLOWANCE: pricing.dailyMileageAllowance || vehicle.dailyMileageAllowance || '',
    EXCESS_MILEAGE_RATE: Number(pricing.excessMileageRate || 0).toFixed(2),
    RENTAL_START_DATE: dateDisplay(session.requestedPickupDate || application.requestedPickupDate || ''),
    WEEKLY_PAYMENT: Number(pricing.weeklyPayment || 0).toFixed(2),
    DOWN_PAYMENT: Number(pricing.downPayment || 0).toFixed(2),
    INSURANCE_PROVIDER: application.insuranceProvider || '',
    INSURANCE_POLICY_NUMBER: application.insurancePolicyNumber || '',
    OPTIONAL_PURCHASE_PRICE: Number(pricing.optionalPurchasePrice || 0).toFixed(2),
    OWNER_SIGNATURE: 'See electronic signature certificate',
    OWNER_SIGNATURE_DATE: 'See electronic signature certificate',
    RENTER_SIGNATURE: 'See electronic signature certificate',
    RENTER_SIGNATURE_DATE: dateDisplay(extra.signedAt || ''),
    RENTER_PHONE: application.phone || ''
  };
}

function buildContract(data, application, vehicle, session, template, extra = {}) {
  const values = contractValues(data, application, vehicle, session, extra);
  const body = nativeSite.renderContract(template.body, values);
  return { body, values, documentHash: nativeSite.contractTemplateHash(body), templateHash: template.hash || nativeSite.contractTemplateHash(template.body) };
}

function safeExtension(type) {
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'application/pdf') return '.pdf';
  return '';
}
function validFileSignature(bytes, type) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return false;
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'application/pdf') return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}

async function savePrivateDocument(file, dataDir, idPrefix = 'doc-upload') {
  const type = String(file && file.type || '').toLowerCase();
  const extension = safeExtension(type);
  if (!extension) throw new Error('Documents must be JPG, PNG, or PDF.');
  const match = String(file && file.dataUrl || '').match(/^data:([^;]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match || match[1].toLowerCase() !== type) throw new Error('The uploaded document could not be verified.');
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Each document must be between 1 byte and 5 MB.');
  if (!validFileSignature(bytes, type)) throw new Error('The uploaded file does not match its JPG, PNG, or PDF format.');
  const folder = path.join(dataDir, 'onboarding-uploads');
  await fs.mkdir(folder, { recursive: true });
  const prefix = text(idPrefix, 40).replace(/[^a-z0-9-]/gi, '') || 'doc-upload';
  const id = prefix + '-' + crypto.randomBytes(10).toString('hex');
  const filename = id + extension;
  await fs.writeFile(path.join(folder, filename), bytes, { flag: 'wx' });
  return {
    id,
    originalName: text(file.name, 180),
    contentType: type,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    storagePath: path.join('onboarding-uploads', filename)
  };
}

async function saveDocuments(data, session, application, files, dataDir) {
  ensureCollections(data);
  const required = ['driver_license_front', 'driver_license_back', 'insurance'];
  const byKind = new Map((files || []).map(file => [String(file.kind || ''), file]));
  if (!required.every(kind => byKind.has(kind))) throw new Error('License front, license back, and insurance proof are all required.');
  const saved = [];
  for (const kind of required) {
    const file = byKind.get(kind) || {};
    const stored = await savePrivateDocument(file, dataDir, 'doc-onboard');
    data.documents = data.documents.filter(document => !(document.applicationId === application.id && document.onboardingSessionId === session.id && document.documentKind === kind));
    const record = {
      id: stored.id,
      applicationId: application.id,
      onboardingSessionId: session.id,
      onlineVehicleId: session.onlineVehicleId,
      customer: application.name || '',
      type: kind === 'insurance' ? 'Insurance' : kind === 'driver_license_front' ? 'Driver license front' : 'Driver license back',
      documentKind: kind,
      originalName: stored.originalName,
      contentType: stored.contentType,
      size: stored.size,
      sha256: stored.sha256,
      storagePath: stored.storagePath,
      status: 'Received - staff verification required',
      visibility: 'Private staff review',
      createdAt: new Date().toISOString()
    };
    data.documents.unshift(record);
    saved.push(record);
  }
  session.documentsCompletedAt = new Date().toISOString();
  session.documentReviewStatus = 'Waiting on staff';
  session.reviewStatus = 'Documents waiting';
  application.onboardingStatus = 'Documents waiting for verification';
  return saved;
}

async function saveSignatureImage(signatureData, session, dataDir) {
  const match = String(signatureData || '').match(/^data:image\/png;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('The drawn signature could not be verified.');
  const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (bytes.length < 100 || bytes.length > 1024 * 1024) throw new Error('The drawn signature is empty or too large.');
  if (!validFileSignature(bytes, 'image/png')) throw new Error('The drawn signature is not a valid PNG image.');
  const folder = path.join(dataDir, 'onboarding-uploads');
  await fs.mkdir(folder, { recursive: true });
  const id = 'signature-' + crypto.randomBytes(10).toString('hex');
  const filename = id + '.png';
  await fs.writeFile(path.join(folder, filename), bytes, { flag: 'wx' });
  return {
    id,
    contentType: 'image/png',
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    storagePath: path.join('onboarding-uploads', filename),
    onboardingSessionId: session.id
  };
}

function pickupWindow(settings, requestedDate) {
  const raw = String(requestedDate || '').slice(0, 10);
  const requested = new Date(raw + 'T12:00:00');
  if (!raw || Number.isNaN(requested.getTime())) return { ok: false, error: 'Choose a valid pickup date.' };
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(settings.minimumPickupDays || 1), 12);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(settings.maximumVehicleHoldDays || 7), 12);
  if (requested < start) return { ok: false, error: 'Online pickup must be scheduled at least one day ahead. Call the office for same-day availability.' };
  if (requested > end) return { ok: false, error: 'A specific vehicle can only be held for seven days. Call the office for a later general inventory appointment.' };
  if (requested.getDay() === 0) return { ok: false, error: 'WheelsonAuto pickup is closed on Sunday.' };
  return { ok: true, raw, weekday: requested.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }) };
}

function pickupWeekday(requestedDate) {
  const raw = String(requestedDate || '').slice(0, 10);
  const requested = new Date(raw + 'T12:00:00-04:00');
  if (!raw || Number.isNaN(requested.getTime())) return '';
  return requested.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
}

function validatePickupTime(value, settings = {}) {
  return nativeSite.pickupTimeSlots(settings).includes(String(value || ''));
}

function pickupSlotOccupancy(data = {}, requestedDate, requestedTime, options = {}) {
  ensureCollections(data);
  const date = String(requestedDate || '').slice(0, 10);
  const time = String(requestedTime || '');
  const excludedSessionId = String(options.excludeSessionId || '');
  const occupied = new Set();
  data.pickupAppointments.forEach(appointment => {
    if (!appointment || appointment.date !== date || appointment.time !== time || /cancel|removed/i.test(String(appointment.status || ''))) return;
    if (excludedSessionId && appointment.onboardingSessionId === excludedSessionId) return;
    occupied.add(appointment.onboardingSessionId ? 'session:' + appointment.onboardingSessionId : 'appointment:' + appointment.id);
  });
  data.onboardingSessions.forEach(session => {
    if (!session || !session.profileCompletedAt || session.requestedPickupDate !== date || session.requestedPickupTime !== time || /replaced|cancelled|expired|rejected/i.test(String(session.status || ''))) return;
    if (excludedSessionId && session.id === excludedSessionId) return;
    occupied.add('session:' + session.id);
  });
  return occupied.size;
}

function pickupAvailability(data = {}, settings = {}, requestedDate, options = {}) {
  const date = String(requestedDate || '').slice(0, 10);
  const capacity = Math.max(1, Math.min(4, Number(settings.pickupCapacity || 2)));
  return nativeSite.pickupTimeSlots(settings).map(time => {
    const used = pickupSlotOccupancy(data, date, time, options);
    return { time, used, capacity, remaining: Math.max(0, capacity - used), available: used < capacity };
  });
}

function createPendingCustomerAccount(data, application, links = {}) {
  ensureCollections(data);
  // A phone number or email can be shared or recycled. Only the application ID
  // is strong enough to reuse a pending portal account without crossing records.
  let account = data.customerAccounts.find(item => item.applicationId === application.id);
  const base = {
    customer: application.name,
    name: application.name,
    username: String(application.email || application.phone || '').toLowerCase(),
    phone: application.phone || '',
    email: application.email || '',
    applicationId: application.id,
    organizationId: application.organizationId || 'org-wheelsonauto',
    status: 'Active',
    source: 'Native website application',
    updatedAt: new Date().toISOString(),
    ...links
  };
  if (account) Object.assign(account, base);
  else {
    account = { id: 'customer-account-' + crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), ...base };
    data.customerAccounts.unshift(account);
  }
  if (application.pendingPasswordHash && application.pendingPasswordSalt) {
    account.passwordHash = application.pendingPasswordHash;
    account.passwordSalt = application.pendingPasswordSalt;
    account.passwordUpdatedAt = application.pendingPasswordUpdatedAt || new Date().toISOString();
    delete application.pendingPasswordHash;
    delete application.pendingPasswordSalt;
    delete application.pendingPasswordUpdatedAt;
  }
  application.customerAccountId = account.id;
  return account;
}

module.exports = {
  text,
  tokenHash,
  ensureCollections,
  activeContractTemplate,
  findPublicVehicle,
  pricingSnapshot,
  createSession,
  findSession,
  releaseExpiredHolds,
  sessionPublicUrl,
  applicationForSession,
  contractValues,
  buildContract,
  saveDocuments,
  savePrivateDocument,
  saveSignatureImage,
  pickupWindow,
  pickupWeekday,
  validatePickupTime,
  pickupSlotOccupancy,
  pickupAvailability,
  createPendingCustomerAccount
};
