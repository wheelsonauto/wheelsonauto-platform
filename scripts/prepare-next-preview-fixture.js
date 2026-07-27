'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || '');
const dataFile = path.join(dataDir, 'data.json');
const liveDataFile = path.join(root, 'data.json');

if (process.env.NODE_ENV === 'production' || process.env.WOA_LOCAL_STAFF_PREVIEW !== '1' || process.env.WOA_PREVIEW_FIXTURE_CONFIRM !== '1') {
  throw new Error('Preview fixture refused. Use nonproduction with WOA_LOCAL_STAFF_PREVIEW=1 and WOA_PREVIEW_FIXTURE_CONFIRM=1.');
}
if (!process.env.DATA_DIR || dataFile === liveDataFile || dataDir === root || !dataDir.startsWith('/tmp/')) {
  throw new Error('Preview fixture refused. DATA_DIR must be an isolated /tmp directory outside the repository.');
}

fs.mkdirSync(dataDir, { recursive: true });
let state = {};
try { state = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { state = {}; }

const now = '2026-07-27T14:35:00.000Z';
const ids = {
  rental: 'rental-next-preview',
  customer: 'customer-next-preview',
  vehicle: 'vehicle-next-preview',
  account: 'customer-account-next-preview',
  application: 'application-next-preview',
  onboarding: 'onboarding-next-preview',
  pickup: 'pickup-next-preview',
  recurring: 'recurring-next-preview',
  contract: 'contract-next-preview'
};

function upsert(collection, record) {
  const rows = Array.isArray(state[collection]) ? state[collection] : [];
  const index = rows.findIndex(row => String(row && row.id || '') === record.id);
  if (index >= 0) rows[index] = { ...rows[index], ...record };
  else rows.unshift(record);
  state[collection] = rows;
}

const base = { organizationId: 'org-wheelsonauto', rentalFileId: ids.rental, updatedAt: now };
upsert('vehicles', { id: ids.vehicle, organizationId: base.organizationId, year: 2021, make: 'Toyota', model: 'Camry SE', vin: '4T1G11AK0MU000001', plate: 'PREVIEW', tracker: 'PT-2048', status: 'Rented', currentCustomer: 'Jordan Preview', activeRentalFileId: ids.rental, mileage: 48230, updatedAt: now });
upsert('customers', { id: ids.customer, organizationId: base.organizationId, name: 'Jordan Preview', customer: 'Jordan Preview', phone: '8565550142', email: 'preview.customer@example.com', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', status: 'Active', stage: 'Active customer', activeRentalFileId: ids.rental, recurringPaymentId: ids.recurring, updatedAt: now });
upsert('customerAccounts', { id: ids.account, organizationId: base.organizationId, customerId: ids.customer, applicationId: ids.application, applicationIds: [ids.application], recurringPaymentId: ids.recurring, vehicleId: ids.vehicle, name: 'Jordan Preview', customer: 'Jordan Preview', email: 'preview.customer@example.com', phone: '8565550142', username: 'previewcustomer', status: 'Active', portalStage: 'Active customer', disabled: false, updatedAt: now });
upsert('applications', { ...base, id: ids.application, customerId: ids.customer, customerAccountId: ids.account, name: 'Jordan Preview', applicantName: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', status: 'Completed', stage: 'Active customer', submittedAt: '2026-07-20T15:30:00.000Z' });
upsert('onboardingSessions', { ...base, id: ids.onboarding, applicationId: ids.application, customerId: ids.customer, customerAccountId: ids.account, vehicleId: ids.vehicle, status: 'Completed', finalReviewStatus: 'Approved', documentReviewStatus: 'Approved', signatureReviewStatus: 'Approved', completedAt: '2026-07-24T16:10:00.000Z' });
upsert('pickupAppointments', { ...base, id: ids.pickup, applicationId: ids.application, onboardingSessionId: ids.onboarding, customerId: ids.customer, vehicleId: ids.vehicle, customer: 'Jordan Preview', vehicle: '2021 Toyota Camry SE', status: 'Picked up', date: '2026-07-25', actualPickupDate: '2026-07-25', pickupMileage: 47892, completedAt: '2026-07-25T15:05:00.000Z' });
upsert('contracts', { ...base, id: ids.contract, applicationId: ids.application, onboardingSessionId: ids.onboarding, customerId: ids.customer, customer: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', status: 'Active', signedAt: '2026-07-24T16:02:00.000Z' });
upsert('recurringPayments', { ...base, id: ids.recurring, applicationId: ids.application, pickupAppointmentId: ids.pickup, customerId: ids.customer, customerAccountId: ids.account, customer: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', amount: 325, weeklyAmount: 325, frequency: 'Weekly', status: 'Active', paymentProvider: 'stripe', autopayManagedBy: 'Stripe', autoChargeEnabled: true, autopayAnchorDate: '2026-07-25', paymentDay: 'Saturday', nextRun: '2026-08-01T18:00:00.000Z', updatedAt: now });
upsert('payments', { ...base, id: 'payment-next-preview-1', recurringPaymentId: ids.recurring, customerId: ids.customer, customer: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', amount: 325, status: 'Paid', provider: 'Stripe', method: 'Visa ending 4242', paidAt: '2026-07-25T15:01:00.000Z', createdAt: '2026-07-25T15:01:00.000Z' });
upsert('paymentRequests', { ...base, id: 'payment-request-next-preview-1', recurringPaymentId: ids.recurring, customerId: ids.customer, customer: 'Jordan Preview', vehicleId: ids.vehicle, amount: 325, type: 'Weekly payment', status: 'Paid', paidAt: '2026-07-25T15:01:00.000Z', createdAt: '2026-07-25T14:55:00.000Z' });
upsert('messages', { ...base, id: 'message-next-preview-1', customerId: ids.customer, customerAccountId: ids.account, customer: 'Jordan Preview', vehicleId: ids.vehicle, channel: 'Customer portal', direction: 'Outbound', status: 'Sent', body: 'Your pickup is confirmed. We will see you Saturday at 3:00 PM.', createdAt: '2026-07-25T13:20:00.000Z' });
upsert('messages', { ...base, id: 'message-next-preview-2', customerId: ids.customer, customerAccountId: ids.account, customer: 'Jordan Preview', vehicleId: ids.vehicle, channel: 'Customer portal', direction: 'Inbound', status: 'Received', body: 'Thank you. I will bring my insurance card.', createdAt: '2026-07-25T13:27:00.000Z' });
upsert('maintenance', { ...base, id: 'maintenance-next-preview-1', customerId: ids.customer, customer: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', type: 'Monthly inspection', issue: 'Monthly inspection and oil check', status: 'Due Aug 24', due: '2026-08-24', createdAt: now });
upsert('claims', { ...base, id: 'claim-next-preview-1', customerId: ids.customer, customer: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', type: 'E-ZPass toll', provider: 'NJ E-ZPass', status: 'Open', amount: 4.85, transactionDate: '2026-07-26', postingDate: '2026-07-27', createdAt: now });
upsert('trackerEvents', { ...base, id: 'tracker-next-preview-1', customerId: ids.customer, customer: 'Jordan Preview', vehicleId: ids.vehicle, vehicle: '2021 Toyota Camry SE', type: 'Location check', status: 'Current', source: 'PassTime manual portal', createdAt: now });

const sourceRefs = [
  ['applications', ids.application], ['onboardingSessions', ids.onboarding], ['pickupAppointments', ids.pickup],
  ['contracts', ids.contract], ['recurringPayments', ids.recurring], ['payments', 'payment-next-preview-1'],
  ['paymentRequests', 'payment-request-next-preview-1'], ['messages', 'message-next-preview-1'],
  ['messages', 'message-next-preview-2'], ['maintenance', 'maintenance-next-preview-1'],
  ['claims', 'claim-next-preview-1'], ['trackerEvents', 'tracker-next-preview-1']
].map(([collection, id]) => ({ collection, id }));
upsert('rentalFiles', { id: ids.rental, organizationId: base.organizationId, customerId: ids.customer, customerName: 'Jordan Preview', customerAccountId: ids.account, vehicleId: ids.vehicle, vehicleName: '2021 Toyota Camry SE', vin: '4T1G11AK0MU000001', plate: 'PREVIEW', tracker: 'PT-2048', status: 'Active', lifecycle: 'Active rental', startDate: '2026-07-25', actualPickupDate: '2026-07-25', autopayAnchorDate: '2026-07-25', paymentDay: 'Saturday', nextChargeDate: '2026-08-01T18:00:00.000Z', weeklyAmount: 325, paymentProvider: 'Stripe', applicationId: ids.application, onboardingSessionId: ids.onboarding, pickupAppointmentId: ids.pickup, recurringPaymentId: ids.recurring, contractId: ids.contract, startingMileage: 47892, sourceRefs, createdAt: '2026-07-25T15:05:00.000Z', updatedAt: now, version: 1 });

fs.writeFileSync(dataFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ok: true, dataFile, rentalFileId: ids.rental, customerAccountId: ids.account }, null, 2));
