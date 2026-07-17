const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function dateKey(value) {
  const raw = text(value);
  if (!raw) return '';
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (direct) return direct[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function compactProviderMessage(value, fallback) {
  const message = text(value).replace(/\s+/g, ' ').slice(0, 280);
  return message || fallback;
}

function splitName(fullName) {
  const parts = text(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' ') || 'Customer'
  };
}

async function providerRequest(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body && (body.error || body.message || (Array.isArray(body.error_codes) && body.error_codes.join(', ')));
    const error = new Error(compactProviderMessage(detail, 'The verification provider rejected the request.'));
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function checkrConfigured(config = {}) {
  return !!(text(config.apiKey) && text(config.backgroundPackage) && text(config.mvrPackage));
}

async function createCheckrInvitation(record = {}, config = {}, fetchImpl = fetch) {
  if (!text(config.apiKey)) throw new Error('Checkr API credentials are not configured.');
  if (config.useCaseConfirmed !== true) throw new Error('Checkr permissible-purpose setup must be confirmed before a live check can start.');
  if (!['background', 'driver_record'].includes(text(record.type))) throw new Error('Checkr can start only a background or driver-record case.');
  if (!text(record.email)) throw new Error('The customer needs an email address before Checkr can send its secure invitation.');
  const packageSlug = record.type === 'driver_record' ? text(config.mvrPackage) : text(config.backgroundPackage);
  if (!packageSlug) throw new Error(record.type === 'driver_record' ? 'The Checkr MVR package is not configured.' : 'The Checkr background package is not configured.');
  const baseUrl = text(config.baseUrl || 'https://api.checkr.com/v1').replace(/\/+$/, '');
  const auth = Buffer.from(text(config.apiKey) + ':').toString('base64');
  const name = splitName(record.customer);
  const candidateBody = new URLSearchParams({
    first_name: name.firstName,
    last_name: name.lastName,
    email: text(record.email),
    custom_id: text(record.id)
  });
  const candidate = await providerRequest(baseUrl + '/candidates', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': text(record.id) + '-candidate'
    },
    body: candidateBody.toString()
  }, fetchImpl);
  if (!text(candidate.id)) throw new Error('Checkr did not return a candidate ID.');
  const invitationBody = new URLSearchParams();
  invitationBody.set('candidate_id', text(candidate.id));
  invitationBody.set('package', packageSlug);
  invitationBody.set('work_locations[][country]', text(config.country || 'US'));
  invitationBody.set('work_locations[][state]', text(config.state || 'NJ'));
  if (text(config.city)) invitationBody.set('work_locations[][city]', text(config.city));
  invitationBody.append('tags[]', 'wheelsonauto');
  invitationBody.append('tags[]', text(record.id));
  const invitation = await providerRequest(baseUrl + '/invitations', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': text(record.id) + '-invitation'
    },
    body: invitationBody.toString()
  }, fetchImpl);
  return {
    provider: 'Checkr',
    providerApplicantId: text(candidate.id),
    providerInvitationId: text(invitation.id),
    providerReportId: text(invitation.report_id),
    externalCaseId: text(invitation.report_id || invitation.id),
    customerActionUrl: /^https:\/\//i.test(text(invitation.invitation_url)) ? text(invitation.invitation_url) : '',
    providerStatus: text(invitation.status || 'pending'),
    expiresAt: dateKey(invitation.expires_at),
    providerSubmittedAt: text(invitation.created_at) || new Date().toISOString()
  };
}

function mapCheckrStatus(payload = {}) {
  const object = payload && payload.data && payload.data.object ? payload.data.object : payload;
  const status = text(object.status || payload.status).toLowerCase();
  const result = text(object.result || payload.result || object.assessment || payload.assessment).toLowerCase();
  if (/clear|eligible/.test(result)) return 'clear';
  if (/consider|review|escalated/.test(result)) return 'consider';
  if (/dispute/.test(status)) return 'disputed';
  if (/suspend|verification/.test(status)) return 'correction requested';
  if (/cancel/.test(status)) return 'canceled';
  if (/complete/.test(status)) return result || 'complete';
  if (/pending/.test(status)) return 'provider pending';
  return status || 'provider pending';
}

async function refreshCheckrCase(record = {}, config = {}, fetchImpl = fetch) {
  if (!text(config.apiKey)) throw new Error('Checkr API credentials are not configured.');
  const baseUrl = text(config.baseUrl || 'https://api.checkr.com/v1').replace(/\/+$/, '');
  const auth = Buffer.from(text(config.apiKey) + ':').toString('base64');
  let payload;
  if (text(record.providerReportId)) {
    payload = await providerRequest(baseUrl + '/reports/' + encodeURIComponent(text(record.providerReportId)), {
      headers: { Authorization: 'Basic ' + auth }
    }, fetchImpl);
  } else if (text(record.providerInvitationId || record.externalCaseId)) {
    payload = await providerRequest(baseUrl + '/invitations/' + encodeURIComponent(text(record.providerInvitationId || record.externalCaseId)), {
      headers: { Authorization: 'Basic ' + auth }
    }, fetchImpl);
  } else {
    throw new Error('This case has no Checkr invitation or report ID to refresh.');
  }
  return {
    provider: 'Checkr',
    providerStatus: mapCheckrStatus(payload),
    providerReportId: text(payload.report_id || (payload.object === 'report' ? payload.id : record.providerReportId)),
    providerInvitationId: text(payload.object === 'invitation' ? payload.id : record.providerInvitationId),
    externalCaseId: text(payload.report_id || payload.id || record.externalCaseId),
    providerUpdatedAt: text(payload.completed_at || payload.updated_at || payload.created_at) || new Date().toISOString(),
    expiresAt: dateKey(payload.expires_at || record.expiresAt)
  };
}

function verifyCheckrWebhook(rawBody, signature, secret) {
  if (!text(rawBody) || !text(signature) || !text(secret)) return false;
  const expected = crypto.createHmac('sha256', text(secret)).update(String(rawBody)).digest('hex');
  const supplied = text(signature).replace(/^sha256=/i, '').toLowerCase();
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCheckrWebhook(payload = {}) {
  const object = payload && payload.data && payload.data.object ? payload.data.object : {};
  const tags = Array.isArray(object.tags) ? object.tags.map(text) : [];
  const caseId = tags.find(value => /^verify-/i.test(value)) || '';
  return {
    eventId: text(payload.id),
    eventType: text(payload.type),
    caseId,
    provider: 'Checkr',
    externalCaseId: text(object.report_id || object.id),
    providerApplicantId: text(object.candidate_id),
    providerReportId: text(object.object === 'report' ? object.id : object.report_id),
    providerInvitationId: text(object.object === 'invitation' ? object.id : ''),
    providerStatus: mapCheckrStatus(payload),
    status: mapCheckrStatus(payload),
    expiresAt: dateKey(object.expires_at),
    occurredAt: text(payload.created_at)
  };
}

function canopyConfigured(config = {}) {
  return !!text(config.publicAlias);
}

function buildCanopyConnectUrl(record = {}, config = {}) {
  const alias = text(config.publicAlias);
  if (!alias) throw new Error('Canopy Connect public alias is not configured.');
  const url = new URL('https://app.usecanopy.com/c/' + encodeURIComponent(alias));
  url.searchParams.set('ccmeta-verification_case_id', text(record.id));
  if (text(record.vehicleId)) url.searchParams.set('ccmeta-vehicle_id', text(record.vehicleId));
  if (text(record.organizationId)) url.searchParams.set('ccmeta-organization_id', text(record.organizationId));
  return url.toString();
}

function verifyCanopyWebhook(rawBody, header, secret, now = Date.now()) {
  if (!text(rawBody) || !text(header) || !text(secret)) return false;
  const values = {};
  text(header).split(',').forEach(part => {
    const index = part.indexOf('=');
    if (index > 0) values[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  });
  const timestamp = Number(values.t);
  if (!timestamp || Math.abs(now / 1000 - timestamp) > 300 || !values.s) return false;
  const expected = crypto.createHmac('sha256', text(secret)).update(String(timestamp) + '.' + String(rawBody)).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(String(values.s).toLowerCase());
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function canopyMetadata(payload = {}) {
  return payload.meta_data || payload.metadata || (payload.pull && (payload.pull.meta_data || payload.pull.metadata)) || {};
}

function parseCanopyWebhook(payload = {}) {
  const meta = canopyMetadata(payload);
  const eventType = text(payload.event_type || payload.type).toUpperCase();
  const data = payload.data || {};
  let providerStatus = text(data.auth_status || payload.status || eventType).toLowerCase();
  if (eventType === 'COMPLETE' || eventType === 'POLICIES_AVAILABLE' || eventType === 'POLICY_AVAILABLE') providerStatus = 'provider data available';
  if (eventType === 'MONITORING_RECONNECT') providerStatus = 'reconnect required';
  if (eventType === 'ERROR') providerStatus = 'provider failed';
  return {
    eventId: text(payload.id || payload.event_id || [payload.pull_id, eventType, payload.sequence].filter(Boolean).join(':')),
    eventType,
    caseId: text(meta.verification_case_id || meta.verificationCaseId || meta.case_id),
    vehicleId: text(meta.vehicle_id || meta.vehicleId),
    organizationId: text(meta.organization_id || meta.organizationId),
    provider: 'Canopy Connect',
    externalCaseId: text(payload.pull_id || (payload.pull && payload.pull.pull_id)),
    providerPullId: text(payload.pull_id || (payload.pull && payload.pull.pull_id)),
    providerMonitoringId: text(payload.monitoring && payload.monitoring.monitoring_id),
    providerStatus,
    status: providerStatus,
    reconnectUrl: /^https:\/\//i.test(text(data.reconnect_url)) ? text(data.reconnect_url) : '',
    isMonitored: payload.is_monitored === true,
    sequence: Number(payload.sequence || 0),
    occurredAt: text(payload.created_at || payload.timestamp)
  };
}

function collectPolicyCandidates(value, rows = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return rows;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectPolicyCandidates(item, rows, seen));
    return rows;
  }
  const keys = Object.keys(value).map(key => key.toLowerCase());
  if (keys.some(key => /policy.?number|policy.?status|expiration|effective.?date/.test(key))) rows.push(value);
  Object.values(value).forEach(item => collectPolicyCandidates(item, rows, seen));
  return rows;
}

function firstValue(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && text(row[name])) return row[name];
  }
  return '';
}

function sanitizeCanopyPull(payload = {}) {
  const candidates = collectPolicyCandidates(payload);
  const policies = candidates.map(row => {
    const policyNumber = text(firstValue(row, ['policy_number', 'policyNumber', 'number']));
    const carrier = firstValue(row, ['carrier_name', 'carrierName', 'insurance_company', 'insurer_name', 'insurerName', 'carrier']);
    const status = firstValue(row, ['policy_status', 'policyStatus', 'status']);
    const effectiveAt = firstValue(row, ['effective_date', 'effectiveDate', 'start_date', 'startDate']);
    const expiresAt = firstValue(row, ['expiration_date', 'expirationDate', 'expiry_date', 'expiryDate', 'end_date', 'endDate']);
    return {
      carrier: typeof carrier === 'object' ? text(carrier.name) : text(carrier),
      policyNumberLast4: policyNumber.slice(-4),
      status: typeof status === 'object' ? text(status.name || status.value) : text(status),
      effectiveAt: dateKey(effectiveAt),
      expiresAt: dateKey(expiresAt)
    };
  }).filter(row => row.carrier || row.policyNumberLast4 || row.status || row.effectiveAt || row.expiresAt);
  const unique = [];
  const fingerprints = new Set();
  policies.forEach(row => {
    const key = JSON.stringify(row);
    if (fingerprints.has(key)) return;
    fingerprints.add(key);
    unique.push(row);
  });
  return unique.slice(0, 20);
}

async function fetchCanopyPull(pullId, config = {}, fetchImpl = fetch) {
  if (!text(config.clientId) || !text(config.clientSecret) || !text(config.teamId)) throw new Error('Canopy Connect API credentials and team ID are not configured.');
  const baseUrl = text(config.baseUrl || 'https://app.usecanopy.com/api/v1.0.0').replace(/\/+$/, '');
  const payload = await providerRequest(baseUrl + '/teams/' + encodeURIComponent(text(config.teamId)) + '/pulls/' + encodeURIComponent(text(pullId)), {
    headers: {
      'x-canopy-client-id': text(config.clientId),
      'x-canopy-client-secret': text(config.clientSecret)
    }
  }, fetchImpl);
  const policies = sanitizeCanopyPull(payload);
  const active = policies.filter(policy => !/cancel|expired|inactive|lapse/i.test(policy.status));
  const expiration = active.map(policy => policy.expiresAt).filter(Boolean).sort()[0] || '';
  return {
    provider: 'Canopy Connect',
    providerPullId: text(pullId),
    externalCaseId: text(pullId),
    providerStatus: active.length ? 'active' : (policies.length ? 'needs staff review' : 'provider data available'),
    carrier: active[0] && active[0].carrier || policies[0] && policies[0].carrier || '',
    policyNumberLast4: active[0] && active[0].policyNumberLast4 || policies[0] && policies[0].policyNumberLast4 || '',
    expiresAt: expiration,
    policyCount: policies.length,
    monitoredPolicySummary: policies,
    providerUpdatedAt: new Date().toISOString()
  };
}

function verificationMonitorState(record = {}, today = dateKey(new Date())) {
  const status = text(record.status || record.providerStatus).toLowerCase();
  const expires = dateKey(record.expiresAt);
  const todayTime = Date.parse(today + 'T12:00:00Z');
  const expiryTime = expires ? Date.parse(expires + 'T12:00:00Z') : NaN;
  const daysRemaining = Number.isFinite(expiryTime) ? Math.ceil((expiryTime - todayTime) / DAY_MS) : null;
  if (/reconnect required/.test(status)) return { level: 'critical', action: 'Send the carrier reconnect link to the customer.', daysRemaining };
  if (/reject|fail|invalid|fraud|mismatch/.test(status)) return { level: 'critical', action: 'Review the provider result and contact the customer.', daysRemaining };
  if (daysRemaining !== null && daysRemaining < 0) return { level: 'critical', action: 'Insurance or verification is expired. Stop pickup and request renewed proof.', daysRemaining };
  if (daysRemaining !== null && daysRemaining <= 7) return { level: 'urgent', action: 'Renewal is due within 7 days. Contact the customer now.', daysRemaining };
  if (daysRemaining !== null && daysRemaining <= 30) return { level: 'warning', action: 'Send a renewal reminder before expiration.', daysRemaining };
  if (/provider setup|required|not connected/.test(status)) return { level: 'setup', action: 'Finish provider setup or complete a manual review.', daysRemaining };
  if (/pending|awaiting customer/.test(status)) return { level: 'pending', action: 'Customer completion is still pending.', daysRemaining };
  if (/consider|review|correction/.test(status)) return { level: 'review', action: 'A staff decision or corrected information is required.', daysRemaining };
  if (/verified|approved|clear|passed|active/.test(status)) return { level: 'clear', action: 'No action needed.', daysRemaining };
  return { level: 'review', action: 'Staff review is required.', daysRemaining };
}

module.exports = {
  dateKey,
  checkrConfigured,
  createCheckrInvitation,
  mapCheckrStatus,
  refreshCheckrCase,
  verifyCheckrWebhook,
  parseCheckrWebhook,
  canopyConfigured,
  buildCanopyConnectUrl,
  verifyCanopyWebhook,
  parseCanopyWebhook,
  sanitizeCanopyPull,
  fetchCanopyPull,
  verificationMonitorState
};
