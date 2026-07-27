import type { CustomerNotifications, CustomerPortal, CustomerPortalEnvelope, PortalRecord } from './types';

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

export async function loadCustomerPortal(signal?: AbortSignal): Promise<CustomerPortal> {
  const response = await fetch('/api/customer/portal-state', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return (await parseJson<CustomerPortalEnvelope>(response)).portal;
}

export async function loadCustomerNotifications(signal?: AbortSignal): Promise<CustomerNotifications> {
  const response = await fetch('/api/customer/notifications', { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  return parseJson<CustomerNotifications>(response);
}

export async function markCustomerNotificationsRead(ids: string[]): Promise<CustomerNotifications> {
  const response = await fetch('/api/customer/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ids })
  });
  return parseJson<CustomerNotifications>(response);
}

export async function sendCustomerMessage(body: string, deliveryId: string): Promise<{ ok: boolean; message: PortalRecord; portal: CustomerPortal }> {
  const response = await fetch('/customer/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ body, deliveryId })
  });
  return parseJson(response);
}

export type CustomerDocumentInput = {
  type: string;
  provider: string;
  reference: string;
  expires: string;
  notes: string;
  file: { name: string; type: string; size: number; dataUrl: string };
};

export async function uploadCustomerDocument(input: CustomerDocumentInput): Promise<{ ok: boolean; document: PortalRecord; message?: string }> {
  const response = await fetch('/customer/document-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input)
  });
  return parseJson(response);
}

