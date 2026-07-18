const crypto = require('crypto');

const STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  OPTED_IN: 'opted_in',
  OPTED_OUT: 'opted_out'
});

const OPT_IN_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);
const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);

function text(value, limit = 300) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['opted_in', 'opt_in', 'subscribed', 'yes', 'true'].includes(status)) return STATUS.OPTED_IN;
  if (['opted_out', 'opt_out', 'unsubscribed', 'no', 'false'].includes(status)) return STATUS.OPTED_OUT;
  return STATUS.UNKNOWN;
}

function classifyInboundKeyword(body) {
  const keyword = text(body, 80).toUpperCase().replace(/[.!]+$/g, '').trim();
  if (OPT_OUT_KEYWORDS.has(keyword)) return { action: 'opt_out', keyword };
  if (OPT_IN_KEYWORDS.has(keyword)) return { action: 'opt_in', keyword };
  return null;
}

function ensureCollections(data) {
  if (!data || typeof data !== 'object') throw new Error('Messaging consent requires platform state.');
  data.messagingConsents = Array.isArray(data.messagingConsents) ? data.messagingConsents : [];
  data.messagingConsentEvents = Array.isArray(data.messagingConsentEvents) ? data.messagingConsentEvents : [];
  return data;
}

function recordTimestamp(record) {
  const value = Date.parse(record && (record.updatedAt || record.recordedAt || record.smsConsentAt || record.createdAt) || '');
  return Number.isFinite(value) ? value : 0;
}

function recordMatches(record, input) {
  if (!record) return false;
  const requestedOrg = text(input.organizationId || '', 120);
  const recordOrg = text(record.organizationId || '', 120);
  if (requestedOrg && recordOrg && requestedOrg !== recordOrg) return false;
  if (input.customerId && String(record.customerId || record.id || '') === String(input.customerId)) return true;
  return !!phoneKey(input.phone) && phoneKey(record.phone || record.mobile || record.username) === phoneKey(input.phone);
}

function legacyCandidates(data, input) {
  const collections = ['customers', 'contracts', 'recurringPayments', 'recurring', 'customerAccounts', 'applications'];
  const result = [];
  collections.forEach(collection => {
    (Array.isArray(data && data[collection]) ? data[collection] : []).forEach(record => {
      if (!recordMatches(record, input)) return;
      const status = normalizedStatus(record.smsConsentStatus != null ? record.smsConsentStatus : record.smsConsent);
      if (status === STATUS.UNKNOWN && !record.smsConsentAt) return;
      result.push({
        id: record.smsConsentId || record.id || '',
        customerId: record.customerId || (collection === 'customers' || collection === 'customerAccounts' ? record.id : ''),
        applicationId: collection === 'applications' ? record.id : record.applicationId || '',
        organizationId: record.organizationId || input.organizationId || '',
        phone: record.phone || record.mobile || input.phone || '',
        customer: record.customer || record.name || input.customer || '',
        status,
        source: record.smsConsentSource || (collection + '_record'),
        updatedAt: record.smsConsentAt || record.updatedAt || record.createdAt || ''
      });
    });
  });
  return result;
}

function currentConsent(data, input = {}) {
  const state = data && typeof data === 'object' ? data : {};
  const candidates = (Array.isArray(state.messagingConsents) ? state.messagingConsents : [])
    .filter(record => recordMatches(record, input))
    .concat(legacyCandidates(state, input))
    .sort((a, b) => recordTimestamp(b) - recordTimestamp(a));
  const current = candidates[0];
  if (!current) {
    return {
      status: STATUS.UNKNOWN,
      phone: input.phone || '',
      customer: input.customer || '',
      organizationId: input.organizationId || ''
    };
  }
  return { ...current, status: normalizedStatus(current.status) };
}

function syncConsentFields(data, consent) {
  const collections = ['customers', 'contracts', 'recurringPayments', 'recurring', 'customerAccounts', 'applications'];
  collections.forEach(collection => {
    (Array.isArray(data[collection]) ? data[collection] : []).forEach(record => {
      if (!recordMatches(record, consent)) return;
      record.smsConsentStatus = consent.status;
      record.smsConsentAt = consent.updatedAt;
      record.smsConsentSource = consent.source;
      record.smsConsentId = consent.id;
    });
  });
}

function recordConsent(data, input = {}, options = {}) {
  ensureCollections(data);
  const phone = phoneKey(input.phone);
  if (phone.length !== 10) throw new Error('A valid 10-digit customer phone is required to record SMS consent.');
  const status = normalizedStatus(input.status);
  if (status === STATUS.UNKNOWN) throw new Error('SMS consent must be recorded as opted in or opted out.');
  const organizationId = text(input.organizationId || 'org-wheelsonauto', 120);
  const eventId = text(input.eventId || input.externalId || '', 180);
  if (eventId) {
    const duplicate = data.messagingConsentEvents.find(event => event.eventId === eventId && phoneKey(event.phone) === phone);
    if (duplicate) return { changed: false, duplicate: true, consent: currentConsent(data, { phone, organizationId }), event: duplicate };
  }
  const now = text(options.now || input.recordedAt || new Date().toISOString(), 80);
  let consent = data.messagingConsents.find(record => recordMatches(record, { phone, organizationId }));
  const previousStatus = consent ? normalizedStatus(consent.status) : STATUS.UNKNOWN;
  if (!consent) {
    consent = { id: 'sms-consent-' + crypto.randomBytes(8).toString('hex'), phone, organizationId, createdAt: now };
    data.messagingConsents.unshift(consent);
  }
  Object.assign(consent, {
    phone,
    organizationId,
    customerId: text(input.customerId || consent.customerId || '', 160),
    applicationId: text(input.applicationId || consent.applicationId || '', 160),
    customer: text(input.customer || consent.customer || '', 180),
    status,
    source: text(input.source || 'staff_recorded', 120),
    disclosureVersion: text(input.disclosureVersion || '2026-07-18', 60),
    updatedAt: now,
    recordedBy: text(input.recordedBy || '', 180)
  });
  const event = {
    id: 'sms-consent-event-' + crypto.randomBytes(8).toString('hex'),
    eventId,
    consentId: consent.id,
    phone,
    organizationId,
    customerId: consent.customerId,
    applicationId: consent.applicationId,
    customer: consent.customer,
    previousStatus,
    status,
    source: consent.source,
    keyword: text(input.keyword || '', 40),
    recordedAt: now,
    recordedBy: consent.recordedBy,
    ip: text(input.ip || '', 120),
    userAgent: text(input.userAgent || '', 400),
    disclosureVersion: consent.disclosureVersion
  };
  data.messagingConsentEvents.unshift(event);
  syncConsentFields(data, consent);
  return { changed: previousStatus !== status, duplicate: false, consent, event };
}

function outboundPermission(data, input = {}) {
  if (input.bypass === true) return { allowed: true, status: 'system_bypass', reason: 'Internal owner/system destination.' };
  const phone = phoneKey(input.phone);
  if (phone.length !== 10) return { allowed: false, status: STATUS.UNKNOWN, reason: 'Add a valid customer mobile number before sending.' };
  const consent = currentConsent(data, { ...input, phone });
  if (consent.status === STATUS.OPTED_IN) return { allowed: true, status: consent.status, consent };
  if (consent.status === STATUS.OPTED_OUT) {
    return { allowed: false, status: consent.status, consent, reason: 'This customer opted out of SMS. Ask them to text START before sending another text.' };
  }
  return { allowed: false, status: STATUS.UNKNOWN, consent, reason: 'SMS consent is not recorded. Record written or verbal consent, or ask the customer to text START.' };
}

module.exports = {
  STATUS,
  OPT_IN_KEYWORDS,
  OPT_OUT_KEYWORDS,
  phoneKey,
  normalizedStatus,
  classifyInboundKeyword,
  ensureCollections,
  currentConsent,
  recordConsent,
  outboundPermission
};
