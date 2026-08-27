export function money(value?: number | string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

export function shortDate(value?: string) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(value?: string) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
    const terminal = /history|ended|closed|returned|removed|archived/i.test([row.status, row.stage, row.contractEndedAt, row.archivedAt].join(' '));
    const assigned = vehicles.some(vehicle => !/removed|retired|sold/i.test(vehicle.status || '') && normalized(vehicle.currentCustomer) === key && (!row.vehicleId || String(vehicle.id) === String(row.vehicleId)));
    const score = Number(assigned) * 100 + Number(!terminal && !!row.activeRentalFileId) * 40 + Number(terminal && !assigned) * 55 + Number(!!row.customerAccountId) * 20 + Number(!!row.phone) * 4 + Number(!!row.email) * 4 + (Date.parse(row.updatedAt || '') || 0) / 1e15;
    if (!current) { byName.set(key, { ...row }); return; }
    const currentTerminal = /history|ended|closed|returned|removed|archived/i.test([current.status, current.stage, current.contractEndedAt, current.archivedAt].join(' '));
    const currentAssigned = vehicles.some(vehicle => !/removed|retired|sold/i.test(vehicle.status || '') && normalized(vehicle.currentCustomer) === key && (!current.vehicleId || String(vehicle.id) === String(current.vehicleId)));
    const currentScore = Number(currentAssigned) * 100 + Number(!currentTerminal && !!current.activeRentalFileId) * 40 + Number(currentTerminal && !currentAssigned) * 55 + Number(!!current.customerAccountId) * 20 + Number(!!current.phone) * 4 + Number(!!current.email) * 4 + (Date.parse(current.updatedAt || '') || 0) / 1e15;
    const preferred = score > currentScore ? row : current;
    const fallback = preferred === row ? current : row;
    const preferredTerminal = /history|ended|closed|returned|removed|archived/i.test([preferred.status, preferred.stage, preferred.contractEndedAt, preferred.archivedAt].join(' '));
    byName.set(key, {
      ...fallback,
      ...preferred,
      phone: preferred.phone || fallback.phone,
      email: preferred.email || fallback.email,
      vehicleId: preferredTerminal ? (preferred.vehicleId || '') : (preferred.vehicleId || fallback.vehicleId),
      vehicle: preferredTerminal ? (preferred.vehicle || '') : (preferred.vehicle || fallback.vehicle),
      activeRentalFileId: preferredTerminal ? (preferred.activeRentalFileId || '') : (preferred.activeRentalFileId || fallback.activeRentalFileId)
    });
  });
  return [...byName.values()];
}
import type { CustomerRecord, VehicleRecord } from './types';
