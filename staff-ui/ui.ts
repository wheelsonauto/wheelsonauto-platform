export function money(value?: number | string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

export function shortDate(value?: string) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(value?: string) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function wordsMatch(query: string, values: unknown[]) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = values.map(value => String(value || '')).join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

export function statusTone(value?: string) {
  const status = String(value || '').toLowerCase();
  if (/paid|ready|active|complete|approved|connected|verified|available/.test(status)) return 'good';
  if (/failed twice|denied|declined|overdue|unsafe|error|blocked|removed/.test(status)) return 'bad';
  if (/pending|review|due|failed|setup|waiting|scheduled/.test(status)) return 'warn';
  return 'neutral';
}

export function normalized(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validCustomerName(customer: CustomerRecord) {
  const name = String(customer.name || '').trim();
  const letters = (name.match(/[a-z]/gi) || []).length;
  if (letters < 3 || /^(unknown|unnamed|customer|test|n\/?a)$/i.test(name)) return false;
  if (!name.includes(' ') && /\d/.test(name)) return false;
  return !/^(?:customer|account|setup|onboard|application|recurring|stripe|clover)[-_ ]?[a-z0-9-]+$/i.test(name);
}

export function canonicalCustomerRecords(rows: CustomerRecord[], vehicles: VehicleRecord[]) {
  const byName = new Map<string, CustomerRecord>();
  rows.filter(validCustomerName).forEach(row => {
    const key = normalized(row.name);
    const current = byName.get(key);
    const assigned = vehicles.some(vehicle => !/removed|retired|sold/i.test(vehicle.status || '') && normalized(vehicle.currentCustomer) === key);
    const score = Number(assigned) * 100 + Number(!!row.activeRentalFileId) * 40 + Number(!!row.customerAccountId) * 20 + Number(!!row.phone) * 4 + Number(!!row.email) * 4 + (Date.parse(row.updatedAt || '') || 0) / 1e15;
    if (!current) { byName.set(key, { ...row }); return; }
    const currentScore = Number(assigned) * 100 + Number(!!current.activeRentalFileId) * 40 + Number(!!current.customerAccountId) * 20 + Number(!!current.phone) * 4 + Number(!!current.email) * 4 + (Date.parse(current.updatedAt || '') || 0) / 1e15;
    const preferred = score > currentScore ? row : current;
    const fallback = preferred === row ? current : row;
    byName.set(key, { ...fallback, ...preferred, phone: preferred.phone || fallback.phone, email: preferred.email || fallback.email, vehicleId: preferred.vehicleId || fallback.vehicleId, vehicle: preferred.vehicle || fallback.vehicle, activeRentalFileId: preferred.activeRentalFileId || fallback.activeRentalFileId });
  });
  return [...byName.values()];
}
import type { CustomerRecord, VehicleRecord } from './types';
