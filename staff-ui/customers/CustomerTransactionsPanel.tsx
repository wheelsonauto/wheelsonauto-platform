import { useMemo, useState } from 'react';
import type { CustomerRecord, PaymentRecord } from '../types';
import { dateTime, money, normalized, statusTone, wordsMatch } from '../ui';

function transactionDateKey(payment: PaymentRecord) {
  const value = String(payment.createdAt || payment.date || '').trim();
  const exact = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (exact) return exact[0];
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function paymentCustomer(payment: PaymentRecord, customers: CustomerRecord[]) {
  return customers.find(customer =>
    (!!payment.customerId && String(payment.customerId) === String(customer.id))
    || (!!payment.customerAccountId && !!customer.customerAccountId && String(payment.customerAccountId) === String(customer.customerAccountId))
    || (!!payment.customer && !!customer.name && normalized(payment.customer) === normalized(customer.name))
  );
}

export function CustomerTransactionsPanel({ payments, customers, loading, onOpenCustomer, onOpenRental }: {
  payments: PaymentRecord[];
  customers: CustomerRecord[];
  loading: boolean;
  onOpenCustomer: (customer: CustomerRecord) => void;
  onOpenRental: (rentalId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const visible = useMemo(() => payments.slice().sort((a, b) => (Date.parse(b.createdAt || b.date || '') || 0) - (Date.parse(a.createdAt || a.date || '') || 0)).filter(payment => {
    const date = transactionDateKey(payment);
    if (fromDate && (!date || date < fromDate)) return false;
    if (toDate && (!date || date > toDate)) return false;
    return wordsMatch(query, [payment.customer, payment.vehicle, payment.vin, payment.plate, payment.method, payment.source, payment.provider, payment.status, payment.id, payment.createdAt, payment.date, dateTime(payment.createdAt || payment.date)]);
  }), [payments, query, fromDate, toDate]);

  const open = (payment: PaymentRecord) => {
    if (payment.rentalFileId) { onOpenRental(payment.rentalFileId); return; }
    const customer = paymentCustomer(payment, customers);
    if (customer) onOpenCustomer(customer);
  };

  return <section className="customer-transaction-ledger">
    <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, date, vehicle, reference" /></label>
    <div className="transaction-date-range" aria-label="Transaction date range"><label><span>From</span><input type="date" value={fromDate} max={toDate || undefined} onChange={event => setFromDate(event.target.value)} /></label><label><span>To</span><input type="date" value={toDate} min={fromDate || undefined} onChange={event => setToDate(event.target.value)} /></label>{fromDate || toDate ? <button type="button" className="text-command" onClick={() => { setFromDate(''); setToDate(''); }}>Clear dates</button> : null}</div>
    <div className="record-list">{loading ? <div className="empty-state">Loading transactions...</div> : null}{!loading && !visible.length ? <div className="empty-state">No transactions match this search and date range.</div> : null}{visible.map(payment => <button type="button" key={payment.id} className="record-row" onClick={() => open(payment)} aria-label={`Open ${payment.customer || 'unmatched'} transaction`}><span className={`status-line ${statusTone(payment.status)}`} /><span className="record-main"><strong>{payment.customer || 'Unmatched payment'}</strong><span>{[payment.vehicle, payment.method || payment.provider || payment.source, dateTime(payment.createdAt || payment.date)].filter(Boolean).join(' | ')}</span></span><span className="record-side"><b>{money(payment.amount)}</b><time>{payment.status || 'Recorded'}</time></span></button>)}</div>
  </section>;
}
