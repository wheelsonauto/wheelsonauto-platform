const crypto = require('crypto');

const MAIN_ORG_ID = 'org-wheelsonauto';
const PLAN_LIMITS = {
  Internal: { staff: 0, fleet: 0, customers: 0 },
  Starter: { staff: 3, fleet: 25, customers: 250 },
  Growth: { staff: 10, fleet: 75, customers: 1000 },
  Enterprise: { staff: 0, fleet: 0, customers: 0 }
};
const SUBSCRIPTION_STATUSES = ['Draft', 'Trialing', 'Active', 'Past due', 'Paused', 'Canceled'];
const INVOICE_STATUSES = ['Draft', 'Open', 'Paid', 'Past due', 'Void', 'Refunded'];

function text(value, maxLength = 240) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(Math.max(0, parsed) * 100) / 100 : 0;
}

function integer(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function date(value) {
  const raw = text(value, 40);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function stableId(prefix, parts) {
  return prefix + '-' + crypto.createHash('sha256').update(parts.map(value => text(value, 500)).join('|')).digest('hex').slice(0, 24);
}

function status(value, allowed, fallback) {
  const requested = text(value, 80).toLowerCase();
  return allowed.find(option => option.toLowerCase() === requested) || fallback;
}

function organizationIdFor(row = {}) {
  return text(row.organizationId || row.orgId || row.companyId || MAIN_ORG_ID, 120) || MAIN_ORG_ID;
}

function organizationFor(data = {}, organizationId = MAIN_ORG_ID) {
  const id = text(organizationId, 120) || MAIN_ORG_ID;
  return (data.organizations || []).find(row => text(row.id, 120) === id) || null;
}

function rowsForOrganization(rows, organizationId) {
  const id = text(organizationId, 120) || MAIN_ORG_ID;
  return (rows || []).filter(row => organizationIdFor(row) === id);
}

function activeRow(row = {}) {
  return !/disabled|removed|inactive|history|closed|canceled/i.test(text(row.status || row.stage || 'Active', 120));
}

function organizationUsage(data = {}, organizationId = MAIN_ORG_ID) {
  const staff = rowsForOrganization(data.staffAccounts, organizationId).filter(activeRow).length;
  const fleet = rowsForOrganization(data.vehicles, organizationId).filter(row => !/removed|sold|scrapped/i.test(text(row.status, 80))).length;
  const customerKeys = new Set();
  rowsForOrganization(data.customers, organizationId).filter(activeRow).forEach(row => {
    const key = text(row.id || row.customer || row.name, 180).toLowerCase();
    if (key) customerKeys.add(key);
  });
  rowsForOrganization(data.contracts, organizationId).filter(activeRow).forEach(row => {
    const key = text(row.customer || row.name || row.id, 180).toLowerCase();
    if (key) customerKeys.add(key);
  });
  return { staff, fleet, customers: customerKeys.size };
}

function planLimits(plan, supplied = {}) {
  const name = Object.keys(PLAN_LIMITS).find(option => option.toLowerCase() === text(plan, 80).toLowerCase()) || 'Internal';
  const defaults = PLAN_LIMITS[name];
  return {
    staff: supplied.staff === undefined ? defaults.staff : integer(supplied.staff),
    fleet: supplied.fleet === undefined ? defaults.fleet : integer(supplied.fleet),
    customers: supplied.customers === undefined ? defaults.customers : integer(supplied.customers)
  };
}

function capacity(usage, limits) {
  const result = {};
  ['staff', 'fleet', 'customers'].forEach(key => {
    const used = integer(usage[key]);
    const limit = integer(limits[key]);
    result[key] = {
      used,
      limit,
      unlimited: limit === 0,
      remaining: limit === 0 ? null : Math.max(0, limit - used),
      exceeded: limit > 0 && used > limit
    };
  });
  return result;
}

function assertOrganization(data, organizationId) {
  const organization = organizationFor(data, organizationId);
  if (organization) return organization;
  const error = new Error('Billing company/store was not found.');
  error.statusCode = 400;
  throw error;
}

function upsertSubscription(data = {}, payload = {}, actor = {}, options = {}) {
  data.subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : [];
  const organizationId = text(payload.organizationId || payload.companyId || actor.organizationId || MAIN_ORG_ID, 120) || MAIN_ORG_ID;
  const organization = assertOrganization(data, organizationId);
  const existing = data.subscriptions.find(row => organizationIdFor(row) === organizationId) || null;
  const now = new Date().toISOString();
  const plan = Object.keys(PLAN_LIMITS).find(option => option.toLowerCase() === text(payload.plan || (existing && existing.plan) || organization.plan || 'Internal', 80).toLowerCase()) || 'Internal';
  const suppliedLimits = payload.limits && typeof payload.limits === 'object' ? payload.limits : {
    staff: payload.staffLimit,
    fleet: payload.fleetLimit,
    customers: payload.customerLimit
  };
  const subscription = {
    id: existing && existing.id || stableId('subscription', [organizationId]),
    organizationId,
    plan,
    status: status(payload.status || (existing && existing.status), SUBSCRIPTION_STATUSES, plan === 'Internal' ? 'Active' : 'Draft'),
    amount: number(payload.amount === undefined ? existing && existing.amount : payload.amount),
    currency: text(payload.currency || (existing && existing.currency) || 'USD', 12).toUpperCase() || 'USD',
    interval: /annual|year/i.test(text(payload.interval || (existing && existing.interval), 40)) ? 'Annual' : 'Monthly',
    trialEndsAt: date(payload.trialEndsAt === undefined ? existing && existing.trialEndsAt : payload.trialEndsAt),
    currentPeriodStart: date(payload.currentPeriodStart === undefined ? existing && existing.currentPeriodStart : payload.currentPeriodStart),
    currentPeriodEnd: date(payload.currentPeriodEnd === undefined ? existing && existing.currentPeriodEnd : payload.currentPeriodEnd),
    cancelAtPeriodEnd: payload.cancelAtPeriodEnd === undefined ? !!(existing && existing.cancelAtPeriodEnd) : !!payload.cancelAtPeriodEnd,
    limits: planLimits(plan, existing ? { ...(existing.limits || {}), ...suppliedLimits } : suppliedLimits),
    provider: text(payload.provider || options.provider || (existing && existing.provider) || 'manual', 100).toLowerCase() || 'manual',
    providerCustomerId: text(payload.providerCustomerId === undefined ? existing && existing.providerCustomerId : payload.providerCustomerId, 180),
    providerSubscriptionId: text(payload.providerSubscriptionId === undefined ? existing && existing.providerSubscriptionId : payload.providerSubscriptionId, 180),
    notes: text(payload.notes === undefined ? existing && existing.notes : payload.notes, 2000),
    source: text(options.source || payload.source || (existing && existing.source) || 'WheelsonAuto billing', 120),
    createdAt: existing && existing.createdAt || now,
    updatedAt: now,
    updatedBy: text(actor.name || actor.role || options.provider || 'System', 160)
  };
  if (subscription.currentPeriodStart && subscription.currentPeriodEnd && subscription.currentPeriodEnd < subscription.currentPeriodStart) {
    const error = new Error('Billing period end cannot be before its start date.');
    error.statusCode = 400;
    throw error;
  }
  if (existing) Object.assign(existing, subscription);
  else data.subscriptions.unshift(subscription);
  return { created: !existing, subscription: existing || subscription, organization };
}

function invoiceFingerprint(payload, organizationId) {
  const providerId = text(payload.providerInvoiceId || payload.externalInvoiceId || payload.invoiceId || payload.id, 180);
  return providerId || stableId('billing-invoice', [organizationId, date(payload.date || payload.createdAt || payload.dueAt), date(payload.periodStart), date(payload.periodEnd), number(payload.amount), text(payload.status)]);
}

function recordInvoice(data = {}, payload = {}, actor = {}, options = {}) {
  data.billingInvoices = Array.isArray(data.billingInvoices) ? data.billingInvoices : [];
  const organizationId = text(payload.organizationId || payload.companyId || actor.organizationId || MAIN_ORG_ID, 120) || MAIN_ORG_ID;
  assertOrganization(data, organizationId);
  const providerInvoiceId = invoiceFingerprint(payload, organizationId);
  const existing = data.billingInvoices.find(row => organizationIdFor(row) === organizationId && (text(row.providerInvoiceId, 180) === providerInvoiceId || text(row.id, 180) === text(payload.id, 180))) || null;
  const now = new Date().toISOString();
  const invoice = {
    id: existing && existing.id || stableId('billing-invoice', [organizationId, providerInvoiceId]),
    organizationId,
    providerInvoiceId,
    provider: text(payload.provider || options.provider || (existing && existing.provider) || 'manual', 100).toLowerCase() || 'manual',
    amount: number(payload.amount === undefined ? existing && existing.amount : payload.amount),
    currency: text(payload.currency || (existing && existing.currency) || 'USD', 12).toUpperCase() || 'USD',
    status: status(payload.status || (existing && existing.status), INVOICE_STATUSES, 'Draft'),
    periodStart: date(payload.periodStart === undefined ? existing && existing.periodStart : payload.periodStart),
    periodEnd: date(payload.periodEnd === undefined ? existing && existing.periodEnd : payload.periodEnd),
    dueAt: date(payload.dueAt === undefined ? existing && existing.dueAt : payload.dueAt),
    paidAt: date(payload.paidAt === undefined ? existing && existing.paidAt : payload.paidAt),
    paymentMethod: text(payload.paymentMethod === undefined ? existing && existing.paymentMethod : payload.paymentMethod, 120),
    notes: text(payload.notes === undefined ? existing && existing.notes : payload.notes, 2000),
    source: text(options.source || payload.source || (existing && existing.source) || 'WheelsonAuto billing', 120),
    createdAt: existing && existing.createdAt || now,
    updatedAt: now,
    updatedBy: text(actor.name || actor.role || options.provider || 'System', 160)
  };
  if (invoice.periodStart && invoice.periodEnd && invoice.periodEnd < invoice.periodStart) {
    const error = new Error('Invoice period end cannot be before its start date.');
    error.statusCode = 400;
    throw error;
  }
  if (existing) Object.assign(existing, invoice);
  else data.billingInvoices.unshift(invoice);
  return { created: !existing, invoice: existing || invoice };
}

function providerSubscriptionPayload(event = {}) {
  const object = event.data && event.data.object && typeof event.data.object === 'object' ? event.data.object : {};
  const subscription = event.subscription && typeof event.subscription === 'object' ? event.subscription : {};
  return { ...object, ...subscription, ...event };
}

function mappedSubscriptionStatus(value) {
  const raw = text(value, 80).toLowerCase();
  if (/trial/.test(raw)) return 'Trialing';
  if (/past.?due|unpaid|delinquent/.test(raw)) return 'Past due';
  if (/pause|suspend/.test(raw)) return 'Paused';
  if (/cancel|deleted|ended|terminated/.test(raw)) return 'Canceled';
  if (/active|paid|current/.test(raw)) return 'Active';
  return 'Draft';
}

function mappedInvoiceStatus(value) {
  const raw = text(value, 80).toLowerCase();
  if (/refund/.test(raw)) return 'Refunded';
  if (/void|cancel/.test(raw)) return 'Void';
  if (/past.?due|unpaid|failed/.test(raw)) return 'Past due';
  if (/paid|succeeded|settled/.test(raw)) return 'Paid';
  if (/open|pending|due/.test(raw)) return 'Open';
  return 'Draft';
}

function applyBillingEvent(data = {}, event = {}, actor = {}, options = {}) {
  data.billingEvents = Array.isArray(data.billingEvents) ? data.billingEvents : [];
  const payload = providerSubscriptionPayload(event);
  const organizationId = text(event.organizationId || event.companyId || payload.organizationId || actor.organizationId || MAIN_ORG_ID, 120) || MAIN_ORG_ID;
  assertOrganization(data, organizationId);
  const provider = text(event.provider || options.provider || payload.provider || 'billing-provider', 100).toLowerCase();
  const providerEventId = text(event.eventId || event.providerEventId || event.id, 180) || stableId('billing-event', [organizationId, provider, event.type, event.occurredAt, JSON.stringify({ status: event.status, amount: event.amount, invoiceId: event.invoiceId, subscriptionId: event.subscriptionId })]);
  const duplicate = data.billingEvents.find(row => organizationIdFor(row) === organizationId && text(row.providerEventId, 180) === providerEventId);
  if (duplicate) return { duplicate: true, event: duplicate, subscription: null, invoice: null };

  const type = text(event.type || event.eventType || event.name || 'billing.updated', 120).toLowerCase();
  let subscription = null;
  let invoice = null;
  if (/subscription|customer\.subscription|plan/.test(type) || event.subscription || event.subscriptionId || payload.subscriptionId) {
    subscription = upsertSubscription(data, {
      organizationId,
      plan: payload.plan || payload.planName || payload.priceName,
      status: mappedSubscriptionStatus(payload.status || event.status || type),
      amount: payload.amount || payload.amountDue || payload.unitAmount,
      currency: payload.currency,
      interval: payload.interval || payload.billingInterval,
      trialEndsAt: payload.trialEndsAt || payload.trial_end,
      currentPeriodStart: payload.currentPeriodStart || payload.current_period_start,
      currentPeriodEnd: payload.currentPeriodEnd || payload.current_period_end,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd || payload.cancel_at_period_end,
      provider,
      providerCustomerId: payload.providerCustomerId || payload.customerId || payload.customer,
      providerSubscriptionId: payload.providerSubscriptionId || payload.subscriptionId || payload.subscription_id || payload.id
    }, actor, { provider, source: 'Signed billing provider event' }).subscription;
  }
  if (/invoice|payment|charge/.test(type) || event.invoice || event.invoiceId || payload.invoiceId) {
    invoice = recordInvoice(data, {
      organizationId,
      providerInvoiceId: payload.providerInvoiceId || payload.invoiceId || payload.invoice_id || (/invoice/.test(type) ? payload.id : ''),
      provider,
      amount: payload.amountPaid || payload.amountDue || payload.amount,
      currency: payload.currency,
      status: mappedInvoiceStatus(payload.invoiceStatus || payload.paymentStatus || payload.status || event.status || type),
      periodStart: payload.periodStart || payload.period_start,
      periodEnd: payload.periodEnd || payload.period_end,
      dueAt: payload.dueAt || payload.due_date,
      paidAt: payload.paidAt || payload.paid_at,
      paymentMethod: payload.paymentMethod || payload.payment_method
    }, actor, { provider, source: 'Signed billing provider event' }).invoice;
  }
  const now = new Date().toISOString();
  const record = {
    id: stableId('billing-event', [organizationId, provider, providerEventId]),
    providerEventId,
    organizationId,
    provider,
    type,
    status: text((subscription && subscription.status) || (invoice && invoice.status) || event.status, 80),
    subscriptionId: text(subscription && subscription.id, 180),
    invoiceId: text(invoice && invoice.id, 180),
    amount: number((invoice && invoice.amount) || event.amount),
    occurredAt: text(event.occurredAt || event.createdAt || event.timestamp, 80),
    receivedAt: now
  };
  data.billingEvents.unshift(record);
  data.billingEvents = data.billingEvents.slice(0, 1000);
  return { duplicate: false, event: record, subscription, invoice };
}

function subscriptionSummary(data = {}, organizationId = MAIN_ORG_ID, options = {}) {
  const organization = assertOrganization(data, organizationId);
  const subscription = (data.subscriptions || []).find(row => organizationIdFor(row) === organizationId) || null;
  const plan = text(subscription && subscription.plan || organization.plan || 'Internal', 80) || 'Internal';
  const limits = planLimits(plan, subscription && subscription.limits || {});
  const usage = organizationUsage(data, organizationId);
  const invoices = rowsForOrganization(data.billingInvoices, organizationId)
    .slice()
    .sort((a, b) => text(b.updatedAt || b.createdAt).localeCompare(text(a.updatedAt || a.createdAt)))
    .slice(0, 12)
    .map(row => {
      const safe = { ...row };
      if (!options.includeProviderReferences) delete safe.providerInvoiceId;
      return safe;
    });
  const safeSubscription = subscription ? { ...subscription, limits: { ...limits } } : {
    id: '',
    organizationId,
    plan,
    status: plan.toLowerCase().includes('owner') || plan === 'Internal' ? 'Active' : 'Draft',
    amount: 0,
    currency: 'USD',
    interval: 'Monthly',
    limits,
    provider: options.provider || 'manual'
  };
  if (!options.includeProviderReferences) {
    delete safeSubscription.providerCustomerId;
    delete safeSubscription.providerSubscriptionId;
    delete safeSubscription.notes;
    delete safeSubscription.updatedBy;
  }
  return {
    organization: { id: organization.id, name: organization.name, type: organization.type, status: organization.status },
    subscription: safeSubscription,
    usage,
    capacity: capacity(usage, limits),
    invoices,
    provider: text(options.provider || safeSubscription.provider || 'manual', 100),
    providerConfigured: !!options.providerConfigured,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  PLAN_LIMITS,
  SUBSCRIPTION_STATUSES,
  INVOICE_STATUSES,
  organizationUsage,
  planLimits,
  capacity,
  upsertSubscription,
  recordInvoice,
  applyBillingEvent,
  subscriptionSummary
};
