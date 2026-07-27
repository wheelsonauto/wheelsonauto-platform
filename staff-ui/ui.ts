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
