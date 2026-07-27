import type { ApplicationFeed, CustomerRecord, MaintenanceRecord, MessageFeed, MessageRecord, NotificationFeed, PagedFeed, PaymentRecord, ProviderRecord, RecurringPaymentRecord, RentalDetail, RentalRecord, TaskRecord, VehicleRecord } from './types';

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

export async function draftStarReply(message: MessageRecord): Promise<{ ok: boolean; draft: MessageRecord; plan?: { reply?: string } }> {
  const response = await fetch('/api/messages/ai-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      messageId: message.id,
      customer: message.customer || '',
      phone: message.phone || '',
      email: message.email || '',
      channel: message.channel || '',
      body: message.body || message.subject || '',
      forceNew: true
    })
  });
  return parseJson(response);
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
  return loadPaged<PaymentRecord>('/api/payments?limit=200', signal, force);
}

export function loadAutopay(signal?: AbortSignal, force = false): Promise<PagedFeed<RecurringPaymentRecord>> {
  return loadPaged<RecurringPaymentRecord>('/api/recurring-payments?limit=300', signal, force);
}

export function prewarmStaffFeeds(role: string) {
  const normalized = role.toLowerCase();
  const requests: Promise<unknown>[] = [loadVehicles(), loadTasks(), loadMaintenance()];
  if (normalized !== 'mechanic') requests.push(loadCustomers(), loadPayments());
  if (normalized === 'owner') requests.push(loadAutopay());
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

export function updateCustomer(id: string, payload: Partial<CustomerRecord> & { expectedUpdatedAt?: string }) {
  return patchResource<CustomerRecord>(`/api/customers/${encodeURIComponent(id)}`, payload, ['/api/customers', '/api/app-notifications']);
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
  expectedUpdatedAt: string;
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
