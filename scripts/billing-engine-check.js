const assert = require('assert');
const engine = require('../billing-engine');

const data = {
  organizations: [
    { id: 'org-wheelsonauto', name: 'WheelsonAuto', plan: 'Internal', status: 'Active' },
    { id: 'org-franchise', name: 'Franchise Test', plan: 'Starter', status: 'Active' }
  ],
  staffAccounts: [
    { id: 'staff-main', organizationId: 'org-wheelsonauto', status: 'Active' },
    { id: 'staff-franchise-1', organizationId: 'org-franchise', status: 'Active' },
    { id: 'staff-franchise-disabled', organizationId: 'org-franchise', status: 'Disabled' }
  ],
  vehicles: [
    { id: 'vehicle-main', organizationId: 'org-wheelsonauto', status: 'Rented' },
    { id: 'vehicle-franchise-1', organizationId: 'org-franchise', status: 'Ready' },
    { id: 'vehicle-franchise-removed', organizationId: 'org-franchise', status: 'Removed' }
  ],
  customers: [
    { id: 'customer-main', organizationId: 'org-wheelsonauto', status: 'Active' },
    { id: 'customer-franchise-1', organizationId: 'org-franchise', status: 'Active' }
  ],
  contracts: [
    { id: 'contract-franchise-1', organizationId: 'org-franchise', customer: 'Franchise Customer', status: 'Active' }
  ],
  subscriptions: [],
  billingInvoices: [],
  billingEvents: []
};

const usage = engine.organizationUsage(data, 'org-franchise');
assert.deepEqual(usage, { staff: 1, fleet: 1, customers: 2 }, 'Usage must count only active records inside the selected company.');

const created = engine.upsertSubscription(data, {
  organizationId: 'org-franchise',
  plan: 'Starter',
  status: 'Trialing',
  amount: 149,
  currentPeriodStart: '2026-07-01',
  currentPeriodEnd: '2026-07-31',
  providerCustomerId: 'private-provider-customer',
  providerSubscriptionId: 'private-provider-subscription'
}, { name: 'Owner admin', role: 'Owner' });
assert.equal(created.created, true);
assert.equal(created.subscription.limits.fleet, 25);
assert.equal(data.subscriptions.length, 1);

const updated = engine.upsertSubscription(data, {
  organizationId: 'org-franchise',
  plan: 'Growth',
  status: 'Active',
  amount: 249,
  fleetLimit: 90
}, { name: 'Owner admin', role: 'Owner' });
assert.equal(updated.created, false, 'A company must never receive a second subscription row.');
assert.equal(data.subscriptions.length, 1);
assert.equal(updated.subscription.plan, 'Growth');
assert.equal(updated.subscription.limits.fleet, 90);

const firstInvoice = engine.recordInvoice(data, {
  organizationId: 'org-franchise',
  providerInvoiceId: 'invoice-franchise-1',
  amount: 249,
  status: 'Paid',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31'
}, { name: 'Owner admin', role: 'Owner' });
assert.equal(firstInvoice.created, true);
const duplicateInvoice = engine.recordInvoice(data, {
  organizationId: 'org-franchise',
  providerInvoiceId: 'invoice-franchise-1',
  amount: 249,
  status: 'Paid'
}, { name: 'Owner admin', role: 'Owner' });
assert.equal(duplicateInvoice.created, false, 'Repeating an invoice reference must update instead of duplicating it.');
assert.equal(data.billingInvoices.length, 1);

const event = engine.applyBillingEvent(data, {
  eventId: 'billing-event-franchise-1',
  organizationId: 'org-franchise',
  provider: 'provider-adapter',
  type: 'invoice.paid',
  invoiceId: 'provider-invoice-franchise-2',
  amount: 249,
  status: 'paid',
  rawPayload: { secret: 'must-not-be-stored' }
}, { name: 'Billing provider', role: 'System', organizationId: 'org-franchise' });
assert.equal(event.duplicate, false);
assert.equal(event.invoice.status, 'Paid');
assert.equal(JSON.stringify(data.billingEvents).includes('must-not-be-stored'), false, 'Billing events must never retain raw provider payloads.');
const repeatedEvent = engine.applyBillingEvent(data, {
  eventId: 'billing-event-franchise-1',
  organizationId: 'org-franchise',
  provider: 'provider-adapter',
  type: 'invoice.paid'
});
assert.equal(repeatedEvent.duplicate, true, 'Repeated provider event IDs must remain idempotent.');
assert.equal(data.billingEvents.length, 1);

const managerSummary = engine.subscriptionSummary(data, 'org-franchise', {
  provider: 'provider-adapter',
  providerConfigured: true,
  includeProviderReferences: false
});
assert.equal(managerSummary.organization.id, 'org-franchise');
assert.equal(managerSummary.usage.fleet, 1);
assert.equal(managerSummary.capacity.fleet.limit, 90);
assert.equal(Object.prototype.hasOwnProperty.call(managerSummary.subscription, 'providerCustomerId'), false, 'Manager summary must not expose provider customer references.');
assert.equal(Object.prototype.hasOwnProperty.call(managerSummary.subscription, 'providerSubscriptionId'), false, 'Manager summary must not expose provider subscription references.');
assert.equal(Object.prototype.hasOwnProperty.call(managerSummary.invoices[0], 'providerInvoiceId'), false, 'Manager summary must not expose provider invoice references.');

const ownerSummary = engine.subscriptionSummary(data, 'org-franchise', {
  provider: 'provider-adapter',
  providerConfigured: true,
  includeProviderReferences: true
});
assert.equal(ownerSummary.subscription.providerCustomerId, 'private-provider-customer');
assert(ownerSummary.invoices.some(invoice => invoice.providerInvoiceId === 'invoice-franchise-1'));

const mainSummary = engine.subscriptionSummary(data, 'org-wheelsonauto', { includeProviderReferences: false });
assert.equal(mainSummary.usage.fleet, 1);
assert.equal(mainSummary.usage.customers, 1);
assert.equal(mainSummary.invoices.length, 0, 'Franchise invoices must not leak into the main company summary.');

assert.throws(() => engine.upsertSubscription(data, { organizationId: 'missing-company', plan: 'Starter' }), /not found/i);
assert.throws(() => engine.recordInvoice(data, { organizationId: 'missing-company', amount: 10 }), /not found/i);

console.log('Billing engine checks passed.');
