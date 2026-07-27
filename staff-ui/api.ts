import type { ApplicationFeed, CustomerRecord, MaintenanceRecord, MessageFeed, MessageRecord, NotificationFeed, PagedFeed, PaymentRecord, ProviderRecord, RecurringPaymentRecord, RentalDetail, RentalRecord, TaskRecord, VehicleRecord } from './types';

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

export async function loadMessageFeed(signal?: AbortSignal): Promise<MessageFeed> {
  const response = await fetch('/api/messages/feed?limit=800', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal
  });
  return parseJson<MessageFeed>(response);
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
  return parseJson(response);
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

async function loadPaged<T>(path: string, signal?: AbortSignal): Promise<PagedFeed<T>> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson<PagedFeed<T>>(response);
}

export function loadTasks(signal?: AbortSignal): Promise<PagedFeed<TaskRecord>> {
  return loadPaged<TaskRecord>('/api/tasks?limit=200', signal);
}

export async function saveTask(task: Partial<TaskRecord> & { id: string; expectedUpdatedAt?: string }): Promise<{ ok: boolean; task: TaskRecord; version: string }> {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(task)
  });
  return parseJson(response);
}

export function loadMaintenance(signal?: AbortSignal): Promise<PagedFeed<MaintenanceRecord>> {
  return loadPaged<MaintenanceRecord>('/api/maintenance?limit=200', signal);
}

export function loadVehicles(signal?: AbortSignal): Promise<PagedFeed<VehicleRecord>> {
  return loadPaged<VehicleRecord>('/api/vehicles?limit=200', signal);
}

export function loadCustomers(signal?: AbortSignal): Promise<PagedFeed<CustomerRecord>> {
  return loadPaged<CustomerRecord>('/api/customers?limit=200', signal);
}

export function loadPayments(signal?: AbortSignal): Promise<PagedFeed<PaymentRecord>> {
  return loadPaged<PaymentRecord>('/api/payments?limit=200', signal);
}

export function loadAutopay(signal?: AbortSignal): Promise<PagedFeed<RecurringPaymentRecord>> {
  return loadPaged<RecurringPaymentRecord>('/api/recurring-payments?limit=300', signal);
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
  return parseJson(response);
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
  return parseJson(response);
}

export async function loadApplications(signal?: AbortSignal): Promise<ApplicationFeed> {
  const response = await fetch('/api/applications/live-feed', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson(response);
}

export async function approveApplication(applicationId: string): Promise<{ ok: boolean; onboarding: { id: string; publicUrl?: string }; warning?: string }> {
  const response = await fetch('/api/onboarding/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ applicationId, paymentProvider: 'stripe' })
  });
  return parseJson(response);
}

export async function reviewApplication(applicationId: string, decision: 'deny' | 'restore', notes: string): Promise<{ ok: boolean }> {
  const response = await fetch('/api/applications/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ applicationId, decision, notes })
  });
  return parseJson(response);
}

export async function loadProviders(signal?: AbortSignal): Promise<{ ok: boolean; providers: ProviderRecord[] }> {
  const response = await fetch('/api/api-providers', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson(response);
}

export async function loadNotifications(signal?: AbortSignal): Promise<NotificationFeed> {
  const response = await fetch('/api/app-notifications', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson(response);
}

async function patchResource<T>(path: string, payload: Record<string, unknown>): Promise<{ ok: boolean; record: T; version: string }> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseJson(response);
}

export function updateVehicle(id: string, payload: Partial<VehicleRecord> & { expectedUpdatedAt?: string }) {
  return patchResource<VehicleRecord>(`/api/vehicles/${encodeURIComponent(id)}`, payload);
}

export function updateCustomer(id: string, payload: Partial<CustomerRecord> & { expectedUpdatedAt?: string }) {
  return patchResource<CustomerRecord>(`/api/customers/${encodeURIComponent(id)}`, payload);
}

export async function saveMaintenance(job: Partial<MaintenanceRecord> & { id: string; vehicleId: string; expectedUpdatedAt?: string }): Promise<{ ok: boolean; job: MaintenanceRecord; version: string }> {
  const response = await fetch('/api/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(job)
  });
  return parseJson(response);
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
  return parseJson(response);
}
