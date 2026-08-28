import type { AccountDirectory, ApplicationFeed, ClaimRecord, CustomerAccountRecord, CustomerRecord, DashboardPriorityFeed, MaintenanceRecord, MessageFeed, MessageRecord, NotificationFeed, OrganizationRecord, PagedFeed, PaymentRecord, ProviderRecord, RecurringPaymentRecord, RentalDetail, RentalRecord, ScheduledPaymentRecord, StaffAccountRecord, StarCoachState, TaskRecord, VehicleRecord } from './types';

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

type ResourceCacheEntry = {
  expiresAt: number;
  value?: unknown;
  request?: Promise<unknown>;
};

const RESOURCE_CACHE_MS = 5 * 60_000;
const resourceCache = new Map<string, ResourceCacheEntry>();

function callerAbort<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new DOMException('The request was aborted.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The request was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    request.then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); }
    );
  });
}

async function loadCachedJson<T>(path: string, signal?: AbortSignal, force = false): Promise<T> {
  if (force) resourceCache.delete(path);
  const existing = resourceCache.get(path);
  if (existing?.value !== undefined && existing.expiresAt > Date.now()) return callerAbort(Promise.resolve(existing.value as T), signal);
  if (existing?.request) return callerAbort(existing.request as Promise<T>, signal);

  const entry: ResourceCacheEntry = { expiresAt: 0 };
  const request = fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(parseJson<T>);
  entry.request = request;
  resourceCache.set(path, entry);
  request.then(value => {
    if (resourceCache.get(path) !== entry) return;
    entry.value = value;
    entry.expiresAt = Date.now() + RESOURCE_CACHE_MS;
    delete entry.request;
  }, () => {
    if (resourceCache.get(path) === entry) resourceCache.delete(path);
  });
  return callerAbort(request, signal);
}

function invalidateCachedPaths(...prefixes: string[]) {
  for (const path of resourceCache.keys()) {
    if (prefixes.some(prefix => path.startsWith(prefix))) resourceCache.delete(path);
  }
}

export function loadMessageFeed(signal?: AbortSignal, force = false): Promise<MessageFeed> {
  return loadCachedJson<MessageFeed>('/api/messages/feed?limit=800', signal, force);
}

export type SendMessageInput = {
  customer: string;
  customerId?: string;
  customerAccountId?: string;
  phone?: string;
  email?: string;
  channel: 'Customer portal' | 'Email' | 'SMS';
  body: string;
  deliveryId: string;
};

export async function sendMessage(input: SendMessageInput): Promise<{ ok: boolean; sent: boolean; message: MessageRecord; warning?: string }> {
  const response = await fetch('/api/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; sent: boolean; message: MessageRecord; warning?: string }>(response);
  invalidateCachedPaths('/api/messages/feed', '/api/app-notifications');
  return result;
}

export async function sendMessageAttachment(input: Omit<SendMessageInput, 'channel'> & { file: { name: string; type: string; size: number; dataUrl: string } }): Promise<{ ok: boolean; sent: boolean; warning?: string; message: MessageRecord }> {
  const response = await fetch('/api/messages/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; sent: boolean; warning?: string; message: MessageRecord }>(response);
  invalidateCachedPaths('/api/messages/feed', '/api/app-notifications');
  return result;
}

export async function setMessageReadState(messageIds: string[], unread = false): Promise<{ ok: boolean; changed: number; unread: boolean; changedAt: string }> {
  const response = await fetch('/api/messages/read-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ messageIds, unread })
  });
  const result = await parseJson<{ ok: boolean; changed: number; unread: boolean; changedAt: string }>(response);
  invalidateCachedPaths('/api/messages/feed', '/api/app-notifications');
  return result;
}

export async function draftStarReply(message: MessageRecord): Promise<{ ok: boolean; draft: MessageRecord; plan?: { reply?: string; approvalRequired?: boolean; needsHuman?: boolean; canAutoSend?: boolean }; autoSend?: { attempted: boolean; sent: boolean; message?: MessageRecord; warning?: string } }> {
  const response = await fetch('/api/messages/ai-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      messageId: message.id,
      customer: message.customer || '',
      customerAccountId: message.customerAccountId || '',
      applicationId: message.applicationId || '',
      customerId: message.customerId || '',
      contractId: message.contractId || '',
      recurringPaymentId: message.recurringPaymentId || '',
      vehicleId: message.vehicleId || '',
      phone: message.phone || '',
      email: message.email || '',
      channel: message.channel || '',
      body: message.body || message.subject || '',
      forceNew: false,
      autoSendSafe: true
    })
  });
  const result = await parseJson<{ ok: boolean; draft: MessageRecord; plan?: { reply?: string; approvalRequired?: boolean; needsHuman?: boolean; canAutoSend?: boolean }; autoSend?: { attempted: boolean; sent: boolean; message?: MessageRecord; warning?: string } }>(response);
  invalidateCachedPaths('/api/messages/feed', '/api/app-notifications');
  return result;
}

export async function sendStarInstruction(instruction: string): Promise<{ ok: boolean; response: string; starCoach: StarCoachState }> {
  const response = await fetch('/api/messages/star-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ instruction })
  });
  const result = await parseJson<{ ok: boolean; response: string; starCoach: StarCoachState }>(response);
  invalidateCachedPaths('/api/messages/feed', '/api/system/health');
  return result;
}

async function loadPaged<T>(path: string, signal?: AbortSignal, force = false): Promise<PagedFeed<T>> {
  return loadCachedJson<PagedFeed<T>>(path, signal, force);
}

export function loadTasks(signal?: AbortSignal, force = false): Promise<PagedFeed<TaskRecord>> {
  return loadPaged<TaskRecord>('/api/tasks?limit=200', signal, force);
}

export async function saveTask(task: Partial<TaskRecord> & { id: string; expectedUpdatedAt?: string }): Promise<{ ok: boolean; task: TaskRecord; version: string }> {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(task)
  });
  const result = await parseJson<{ ok: boolean; task: TaskRecord; version: string }>(response);
  invalidateCachedPaths('/api/tasks', '/api/app-notifications');
  return result;
}

export function loadMaintenance(signal?: AbortSignal, force = false): Promise<PagedFeed<MaintenanceRecord>> {
  return loadPaged<MaintenanceRecord>('/api/maintenance?limit=200', signal, force);
}

export function loadVehicles(signal?: AbortSignal, force = false): Promise<PagedFeed<VehicleRecord>> {
  return loadPaged<VehicleRecord>('/api/vehicles?limit=200', signal, force);
}

export function loadCustomers(signal?: AbortSignal, force = false): Promise<PagedFeed<CustomerRecord>> {
  return loadPaged<CustomerRecord>('/api/customers?limit=200', signal, force);
}

export function loadPayments(signal?: AbortSignal, force = false): Promise<PagedFeed<PaymentRecord>> {
  return loadPaged<PaymentRecord>('/api/payments?limit=5000', signal, force);
}

export function loadScheduledPayments(signal?: AbortSignal, force = false): Promise<PagedFeed<ScheduledPaymentRecord>> {
  return loadPaged<ScheduledPaymentRecord>('/api/scheduled-payments?limit=500', signal, force);
}

export async function scheduleOneTimePayment(input: { recurringPaymentId: string; amount: number; scheduledFor: string; reason?: string; note?: string; operationId: string; confirmed: true }): Promise<{ ok: boolean; duplicate?: boolean; scheduledPayment: ScheduledPaymentRecord }> {
  const response = await fetch('/api/scheduled-payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; duplicate?: boolean; scheduledPayment: ScheduledPaymentRecord }>(response);
  invalidateCachedPaths('/api/scheduled-payments', '/api/app-notifications');
  return result;
}

export async function cancelScheduledPayment(scheduledPaymentId: string, reason = 'Cancelled by owner'): Promise<{ ok: boolean; scheduledPayment: ScheduledPaymentRecord }> {
  const response = await fetch('/api/scheduled-payments/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ scheduledPaymentId, reason, confirmed: true })
  });
  const result = await parseJson<{ ok: boolean; scheduledPayment: ScheduledPaymentRecord }>(response);
  invalidateCachedPaths('/api/scheduled-payments', '/api/app-notifications');
  return result;
}

export function loadClaims(signal?: AbortSignal, force = false): Promise<PagedFeed<ClaimRecord>> {
  return loadPaged<ClaimRecord>('/api/claims?limit=500', signal, force);
}

export function loadDashboardPriority(signal?: AbortSignal, force = false): Promise<DashboardPriorityFeed> {
  return loadCachedJson<DashboardPriorityFeed>('/api/dashboard/priority-feed', signal, force);
}

export function loadAutopay(signal?: AbortSignal, force = false): Promise<PagedFeed<RecurringPaymentRecord>> {
  return loadPaged<RecurringPaymentRecord>('/api/recurring-payments?limit=300', signal, force);
}

export function prewarmStaffFeeds(role: string) {
  const normalized = role.toLowerCase();
  const requests: Promise<unknown>[] = [loadVehicles(), loadTasks(), loadMaintenance()];
  if (normalized !== 'mechanic') requests.push(loadCustomers(), loadMessageFeed(), loadApplications());
  if (normalized === 'owner') requests.push(loadPayments(), loadAutopay(), loadScheduledPayments());
  void Promise.allSettled(requests);
}

export type CreateAutopayInput = {
  customer: string;
  phone?: string;
  email?: string;
  vehicle: string;
  vehicleId: string;
  vin?: string;
  licensePlate?: string;
  plate?: string;
  tempTag?: string;
  tracker?: string;
  amount: number;
  frequency: string;
  nextRun: string;
  chargeTime: string;
  notes?: string;
};

export async function createAutopay(input: CreateAutopayInput): Promise<{ ok: boolean; autopay: RecurringPaymentRecord; setupLink: { id: string; url: string } }> {
  const response = await fetch('/api/card-setup-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...input,
      paymentProvider: 'stripe',
      paymentSetup: 'Waiting on Stripe card setup',
      deferVehicleAssignment: true
    })
  });
  const result = await parseJson<{ ok: boolean; autopay: RecurringPaymentRecord; setupLink: { id: string; url: string } }>(response);
  invalidateCachedPaths('/api/recurring-payments', '/api/customers', '/api/payments', '/api/app-notifications');
  return result;
}

export async function chargeSavedCard(input: {
  recurringPaymentId: string;
  amount: number;
  chargePurpose: 'one_time' | 'dues';
  reason?: string;
  note?: string;
  operationId: string;
  allowAdditionalManualCharge: true;
}): Promise<{ ok: boolean; payment: PaymentRecord; charge?: Record<string, unknown> }> {
  const response = await fetch('/api/integrations/payments/manual-charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; payment: PaymentRecord; charge?: Record<string, unknown> }>(response);
  invalidateCachedPaths('/api/payments', '/api/recurring-payments', '/api/customers', '/api/app-notifications');
  return result;
}

export async function recordManualPaymentResult(input: {
  recurringPaymentId: string;
  expectedUpdatedAt?: string;
  operationId: string;
  result: string;
  amount: number;
  method: string;
  nextRun?: string;
  notes?: string;
}): Promise<{ ok: boolean; duplicate?: boolean; payment: PaymentRecord; recurring: RecurringPaymentRecord }> {
  const response = await fetch('/api/payments/manual-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; duplicate?: boolean; payment: PaymentRecord; recurring: RecurringPaymentRecord }>(response);
  invalidateCachedPaths('/api/payments', '/api/recurring-payments', '/api/customers', '/api/app-notifications');
  return result;
}

export async function createPaymentLink(input: {
  recurringPaymentId: string;
  customer?: string;
  phone?: string;
  email?: string;
  vehicle?: string;
  amount: number;
  frequency?: string;
  reason?: string;
  note?: string;
}): Promise<{ ok: boolean; paymentLink: { id: string; url: string; checkoutHref?: string } }> {
  const response = await fetch('/api/payment-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; paymentLink: { id: string; url: string; checkoutHref?: string } }>(response);
  invalidateCachedPaths('/api/recurring-payments', '/api/app-notifications');
  return result;
}

export async function createReplacementCardSetup(row: RecurringPaymentRecord, provider: 'stripe' | 'clover', note = ''): Promise<{ ok: boolean; autopay: RecurringPaymentRecord; setupLink: { id: string; url: string } }> {
  const response = await fetch('/api/card-setup-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: row.id,
      recurringPaymentId: row.id,
      reactivateExisting: true,
      cardOnlyUpdate: true,
      paymentProvider: provider,
      customer: row.customer,
      phone: row.phone,
      email: row.email,
      vehicle: row.vehicle,
      vehicleId: row.vehicleId,
      vin: row.vin,
      licensePlate: row.licensePlate,
      plate: row.plate,
      tempTag: row.tempTag,
      tracker: row.tracker,
      amount: Number(row.amount || 0),
      frequency: row.frequency || 'Weekly',
      nextRun: row.nextRun,
      chargeTime: row.chargeTime || '18:00',
      reason: 'Change card on file',
      notes: [row.notes, note].filter(Boolean).join('\n')
    })
  });
  const result = await parseJson<{ ok: boolean; autopay: RecurringPaymentRecord; setupLink: { id: string; url: string } }>(response);
  invalidateCachedPaths('/api/recurring-payments', '/api/customers', '/api/app-notifications');
  return result;
}

export async function updateAutopay(input: {
  recurringPaymentId: string;
  nextRun: string;
  frequency: string;
  amount: number;
  status: string;
  chargeTime: string;
  retryRule?: string;
  autopayManagedBy?: string;
  note?: string;
  autoChargeEnabled?: boolean;
}): Promise<{ ok: boolean; nextRun: string; frequency: string; amount: number; status: string; chargeTime: string; autoChargeEnabled: boolean }> {
  const response = await fetch('/api/recurring-payments/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; nextRun: string; frequency: string; amount: number; status: string; chargeTime: string; autoChargeEnabled: boolean }>(response);
  invalidateCachedPaths('/api/recurring-payments', '/api/customers', '/api/payments', '/api/app-notifications');
  return result;
}

export async function removeAutopay(recurringPaymentId: string, note: string): Promise<{ ok: boolean; removedAt: string }> {
  const response = await fetch('/api/recurring-payments/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ recurringPaymentId, note })
  });
  const result = await parseJson<{ ok: boolean; removedAt: string }>(response);
  invalidateCachedPaths('/api/recurring-payments', '/api/customers', '/api/payments', '/api/app-notifications');
  return result;
}

export async function deleteCardSetup(recurringPaymentId: string): Promise<{ ok: boolean; deletedRecurring: number; deletedRequests: number }> {
  const response = await fetch('/api/card-setup-requests/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ recurringPaymentId })
  });
  const result = await parseJson<{ ok: boolean; deletedRecurring: number; deletedRequests: number }>(response);
  invalidateCachedPaths('/api/recurring-payments', '/api/customers', '/api/app-notifications');
  return result;
}

export async function loadRentals(signal?: AbortSignal): Promise<{ ok: boolean; records: RentalRecord[]; count: number }> {
  const response = await fetch('/api/rentals', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson(response);
}

export async function loadRentalDetail(id: string, signal?: AbortSignal): Promise<RentalDetail> {
  const response = await fetch(`/api/rentals/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson<RentalDetail>(response);
}

export type RentalReturnInput = {
  endDate: string;
  endingMileage: number;
  vehicleStatus: 'Ready' | 'Prep' | 'Service';
  reason: string;
};

export async function completeRentalReturn(id: string, input: RentalReturnInput): Promise<{ ok: boolean; alreadyEnded: boolean; rentalFile: RentalRecord; vehicle?: VehicleRecord }> {
  const response = await fetch(`/api/rentals/${encodeURIComponent(id)}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...input, confirmation: 'RETURN_RENTAL_VEHICLE' })
  });
  const result = await parseJson<{ ok: boolean; alreadyEnded: boolean; rentalFile: RentalRecord; vehicle?: VehicleRecord }>(response);
  invalidateCachedPaths('/api/rentals', '/api/vehicles', '/api/customers', '/api/payments', '/api/recurring-payments', '/api/app-notifications');
  return result;
}

export function loadApplications(signal?: AbortSignal, force = false): Promise<ApplicationFeed> {
  return loadCachedJson<ApplicationFeed>('/api/applications/live-feed', signal, force);
}

export async function approveApplication(applicationId: string): Promise<{ ok: boolean; onboarding: { id: string; publicUrl?: string }; warning?: string }> {
  const response = await fetch('/api/onboarding/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ applicationId, paymentProvider: 'stripe' })
  });
  const result = await parseJson<{ ok: boolean; onboarding: { id: string; publicUrl?: string }; warning?: string }>(response);
  invalidateCachedPaths('/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export async function reviewApplication(applicationId: string, decision: 'deny' | 'restore', notes: string): Promise<{ ok: boolean }> {
  const response = await fetch('/api/applications/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ applicationId, decision, notes })
  });
  const result = await parseJson<{ ok: boolean }>(response);
  invalidateCachedPaths('/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export function loadProviders(signal?: AbortSignal, force = false): Promise<{ ok: boolean; providers: ProviderRecord[] }> {
  return loadCachedJson<{ ok: boolean; providers: ProviderRecord[] }>('/api/api-providers', signal, force);
}

export function loadNotifications(signal?: AbortSignal, force = false): Promise<NotificationFeed> {
  return loadCachedJson<NotificationFeed>('/api/app-notifications', signal, force);
}

export async function markNotificationsRead(ids: string[] = [], all = false): Promise<NotificationFeed> {
  const response = await fetch('/api/app-notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(all ? { all: true } : { ids })
  });
  const result = await parseJson<NotificationFeed>(response);
  invalidateCachedPaths('/api/app-notifications');
  return result;
}

async function patchResource<T>(path: string, payload: Record<string, unknown>, invalidate: string[]): Promise<{ ok: boolean; record: T; version: string }> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await parseJson<{ ok: boolean; record: T; version: string }>(response);
  invalidateCachedPaths(...invalidate);
  return result;
}

export function updateVehicle(id: string, payload: Partial<VehicleRecord> & { expectedUpdatedAt?: string }) {
  return patchResource<VehicleRecord>(`/api/vehicles/${encodeURIComponent(id)}`, payload, ['/api/vehicles', '/api/customers', '/api/app-notifications']);
}

export async function createVehicle(payload: Partial<VehicleRecord> & { weeklyPayment?: number; downPayment?: number }): Promise<{ ok: boolean; record: VehicleRecord }> {
  const response = await fetch('/api/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await parseJson<{ ok: boolean; record: VehicleRecord }>(response);
  invalidateCachedPaths('/api/vehicles', '/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export async function uploadVehiclePhoto(id: string, input: { expectedUpdatedAt?: string; file: { name: string; type: string; size: number; dataUrl: string } }): Promise<{ ok: boolean; record: VehicleRecord }> {
  const response = await fetch(`/api/vehicles/${encodeURIComponent(id)}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; record: VehicleRecord }>(response);
  invalidateCachedPaths('/api/vehicles', '/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export async function removeVehiclePhoto(id: string, photoId: string, photoUrl: string, expectedUpdatedAt?: string): Promise<{ ok: boolean; record: VehicleRecord }> {
  const response = await fetch(`/api/vehicles/${encodeURIComponent(id)}/photos/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ photoId, photoUrl, expectedUpdatedAt })
  });
  const result = await parseJson<{ ok: boolean; record: VehicleRecord }>(response);
  invalidateCachedPaths('/api/vehicles', '/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export async function archiveVehicle(id: string, expectedUpdatedAt?: string): Promise<{ ok: boolean; record: VehicleRecord; alreadyRemoved?: boolean }> {
  const response = await fetch(`/api/vehicles/${encodeURIComponent(id)}/retire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ expectedUpdatedAt, confirmation: 'REMOVE_VEHICLE' })
  });
  const result = await parseJson<{ ok: boolean; record: VehicleRecord; alreadyRemoved?: boolean }>(response);
  invalidateCachedPaths('/api/vehicles', '/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export function updateCustomer(id: string, payload: Partial<CustomerRecord> & { expectedUpdatedAt?: string }) {
  return patchResource<CustomerRecord>(`/api/customers/${encodeURIComponent(id)}`, payload, ['/api/customers', '/api/app-notifications']);
}

export async function createCustomer(payload: Partial<CustomerRecord>): Promise<{ ok: boolean; record: CustomerRecord }> {
  const response = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
  const result = await parseJson<{ ok: boolean; record: CustomerRecord }>(response);
  invalidateCachedPaths('/api/customers', '/api/app-notifications');
  return result;
}

export async function archiveCustomer(id: string, input: { expectedUpdatedAt?: string; contractEndedAt: string; reason: string }): Promise<{ ok: boolean; record: CustomerRecord; vehicle?: VehicleRecord }> {
  const response = await fetch(`/api/customers/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...input, confirmation: 'END_CUSTOMER_CONTRACT' }) });
  const result = await parseJson<{ ok: boolean; record: CustomerRecord; vehicle?: VehicleRecord }>(response);
  invalidateCachedPaths('/api/customers', '/api/vehicles', '/api/recurring-payments', '/api/payments', '/api/rentals', '/api/app-notifications');
  return result;
}

export async function assignCustomerVehicle(customerId: string, input: { vehicleId: string; expectedUpdatedAt?: string; reason: string; replaceExistingCustomer?: boolean }): Promise<{ ok: boolean; unchanged: boolean; customer: CustomerRecord; vehicle: VehicleRecord; previousVehicle?: VehicleRecord; propagated: string[] }> {
  const response = await fetch(`/api/customers/${encodeURIComponent(customerId)}/vehicle-assignment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...input, confirmation: 'ASSIGN_EXACT_CUSTOMER_VEHICLE', replacementConfirmation: input.replaceExistingCustomer ? 'END_PRIOR_CUSTOMER_AND_REASSIGN' : '' })
  });
  const result = await parseJson<{ ok: boolean; unchanged: boolean; customer: CustomerRecord; vehicle: VehicleRecord; previousVehicle?: VehicleRecord; propagated: string[] }>(response);
  invalidateCachedPaths('/api/customers', '/api/vehicles', '/api/recurring-payments', '/api/payments', '/api/rentals', '/api/app-notifications');
  return result;
}

export async function updateVehicleState(id: string, input: { status: 'online' | 'offline' | 'ready' | 'prep' | 'service' | 'returned'; expectedUpdatedAt?: string }): Promise<{ ok: boolean; record: VehicleRecord; setupRequired?: boolean }> {
  const response = await fetch(`/api/vehicles/${encodeURIComponent(id)}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...input, confirmation: 'CHANGE_EXACT_VEHICLE_STATE' })
  });
  const result = await parseJson<{ ok: boolean; record: VehicleRecord; setupRequired?: boolean }>(response);
  invalidateCachedPaths('/api/vehicles', '/api/customers', '/api/applications/live-feed', '/api/app-notifications');
  return result;
}

export async function saveMaintenance(job: Partial<MaintenanceRecord> & { id: string; vehicleId: string; expectedUpdatedAt?: string }): Promise<{ ok: boolean; job: MaintenanceRecord; version: string }> {
  const response = await fetch('/api/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(job)
  });
  const result = await parseJson<{ ok: boolean; job: MaintenanceRecord; version: string }>(response);
  invalidateCachedPaths('/api/maintenance', '/api/vehicles', '/api/tasks', '/api/app-notifications');
  return result;
}

export type MaintenanceCompletionInput = {
  expectedUpdatedAt?: string;
  cost?: number;
  completedAt: string;
  odometer?: string | number;
  inspectionCondition: string;
  inspectionChecklist: string[];
  damageNotes?: string;
  mechanicSignoff: string;
  notes?: string;
};

export async function completeMaintenance(id: string, input: MaintenanceCompletionInput): Promise<{ ok: boolean; job: MaintenanceRecord; vehicle: VehicleRecord; nextReminder?: MaintenanceRecord; version: string }> {
  const response = await fetch(`/api/maintenance/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await parseJson<{ ok: boolean; job: MaintenanceRecord; vehicle: VehicleRecord; nextReminder?: MaintenanceRecord; version: string }>(response);
  invalidateCachedPaths('/api/maintenance', '/api/vehicles', '/api/tasks', '/api/app-notifications');
  return result;
}

export async function createClaim(input: { customerId: string; vehicleId?: string; type: string; amount: number; due?: string; incidentDate?: string; reference?: string; notes?: string; file?: { name: string; type: string; size: number; dataUrl: string } }): Promise<{ ok: boolean; claim: ClaimRecord }> {
  const response = await fetch('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input) });
  const result = await parseJson<{ ok: boolean; claim: ClaimRecord }>(response);
  invalidateCachedPaths('/api/claims', '/api/customers', '/api/app-notifications');
  return result;
}

export async function archiveClaim(id: string, expectedUpdatedAt?: string, reason = 'Removed by staff.'): Promise<{ ok: boolean; claim: ClaimRecord }> {
  const response = await fetch(`/api/claims/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ expectedUpdatedAt, reason, confirmation: 'REMOVE_CUSTOMER_DUE' }) });
  const result = await parseJson<{ ok: boolean; claim: ClaimRecord }>(response);
  invalidateCachedPaths('/api/claims', '/api/customers', '/api/app-notifications');
  return result;
}

export function loadAccountDirectory(signal?: AbortSignal, force = false): Promise<AccountDirectory> {
  return loadCachedJson<AccountDirectory>('/api/owner/account-directory', signal, force);
}

async function saveAccount<T>(path: string, payload: Record<string, unknown>, key: string): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
  const result = await parseJson<T>(response);
  invalidateCachedPaths('/api/owner/account-directory', key);
  return result;
}

export function saveStaffAccount(payload: Partial<StaffAccountRecord> & { password?: string }) {
  return saveAccount<{ ok: boolean; staff: StaffAccountRecord }>('/api/staff-accounts', payload as Record<string, unknown>, '/api/staff-accounts');
}

export function saveCustomerAccount(payload: Partial<CustomerAccountRecord> & { password?: string }) {
  return saveAccount<{ ok: boolean; account: CustomerAccountRecord }>('/api/customer-accounts', payload as Record<string, unknown>, '/api/customer-accounts');
}

export function saveOrganization(payload: Partial<OrganizationRecord>) {
  return saveAccount<{ ok: boolean; organization: OrganizationRecord }>('/api/organizations', payload as Record<string, unknown>, '/api/organizations');
}

export async function assistCustomerAccount(id: string): Promise<{ ok: boolean; url: string; account: CustomerAccountRecord }> {
  const response = await fetch('/api/customer-accounts/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id }) });
  return parseJson<{ ok: boolean; url: string; account: CustomerAccountRecord }>(response);
}
