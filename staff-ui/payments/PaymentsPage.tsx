import { useEffect, useMemo, useState } from 'react';
import { loadPayments } from '../api';
import type { PaymentRecord } from '../types';
import { dateTime, money, statusTone, wordsMatch } from '../ui';

type Filter = 'all' | 'paid' | 'attention' | 'unmatched';

function provider(payment: PaymentRecord) { return payment.paymentProvider || payment.provider || (/stripe/i.test([payment.method, payment.source].join(' ')) ? 'Stripe' : /clover/i.test([payment.method, payment.source].join(' ')) ? 'Clover' : 'Recorded'); }

export function PaymentsPage({ onOpenRental }: { onOpenRental: (rentalId: string) => void }) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal) => {
    try { const feed = await loadPayments(signal); setPayments(feed.records || []); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const events = new EventSource('/api/events'); events.addEventListener('platform', (event: MessageEvent) => { try { const payload = JSON.parse(event.data || '{}'); if ((payload.topics || []).includes('payments')) void refresh(); } catch { /* next event repairs the view */ } }); return () => { controller.abort(); events.close(); }; }, []);

  const ordered = useMemo(() => payments.slice().sort((a, b) => (Date.parse(b.createdAt || b.date || '') || 0) - (Date.parse(a.createdAt || a.date || '') || 0)), [payments]);
  const visible = useMemo(() => ordered.filter(payment => {
    const status = String(payment.status || '').toLowerCase();
    if (filter === 'paid' && !/paid|succeeded|complete/.test(status)) return false;
    if (filter === 'attention' && !/failed|declined|pending|not found|review/.test(status)) return false;
    if (filter === 'unmatched' && !/unmatched|unknown/.test([payment.customer, status].join(' ').toLowerCase())) return false;
    return wordsMatch(query, [payment.customer, payment.vehicle, payment.vin, payment.plate, payment.method, payment.source, payment.status, payment.id]);
  }), [ordered, query, filter]);
  const selected = payments.find(row => row.id === selectedId) || null;
  const paid = payments.filter(row => /paid|succeeded|complete/i.test(row.status || ''));
  const counts = { all: payments.length, paid: paid.length, attention: payments.filter(row => /failed|declined|pending|not found|review/i.test(row.status || '')).length, unmatched: payments.filter(row => /unmatched|unknown/i.test([row.customer, row.status].join(' '))).length };

  return <main className={`operations-workspace resource-workspace ${selected ? 'has-detail' : ''}`}>
    <section className="operations-index">
      <header className="workspace-title"><div><span>Unified transaction ledger</span><h1>Payments</h1></div><div className="workspace-total"><span>Loaded total</span><strong>{money(paid.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong></div></header>
      <div className="compact-metrics four">{(['all', 'paid', 'attention', 'unmatched'] as Filter[]).map(key => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{key[0].toUpperCase() + key.slice(1)}</span><strong>{counts[key]}</strong></button>)}</div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, vehicle, VIN, tag, transaction" /></label>
      {error ? <div className="inline-alert error">{error}</div> : null}
      <div className="record-list payment-records">{loading ? <div className="empty-state">Loading transactions...</div> : null}{!loading && !visible.length ? <div className="empty-state">No transactions match this view.</div> : null}
        {visible.map(payment => <button key={payment.id} className={payment.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(payment.id)}><span className={`status-line ${statusTone(payment.status)}`} /><span className="record-main"><strong>{payment.customer || 'Unmatched payment'}</strong><span>{[payment.vehicle, provider(payment), dateTime(payment.createdAt || payment.date)].filter(Boolean).join(' | ')}</span></span><span className="record-side"><b>{money(payment.amount)}</b><time>{payment.status || 'Recorded'}</time></span></button>)}
      </div>
    </section>
    <section className="operations-detail">{!selected ? <div className="detail-empty"><strong>Select a transaction</strong><span>Review the exact customer, vehicle, amount, source, and status.</span></div> : <div className="static-detail">
      <header className="detail-header"><button className="detail-back" onClick={() => setSelectedId('')}>Back</button><div><span>Transaction</span><h2>{selected.customer || 'Unmatched payment'}</h2></div><em className={`status-chip ${statusTone(selected.status)}`}>{selected.status || 'Recorded'}</em></header>
      <div className="detail-scroll"><section className="money-summary"><span>{provider(selected)}</span><strong>{money(selected.amount)}</strong><small>{dateTime(selected.createdAt || selected.date)}</small></section>{selected.rentalFileId ? <div className="context-actions"><button className="primary-command compact" onClick={() => onOpenRental(selected.rentalFileId || '')}>Open Rental File</button></div> : null}<dl className="detail-list"><div><dt>Customer</dt><dd>{selected.customer || 'Needs exact match'}</dd></div><div><dt>Vehicle</dt><dd>{selected.vehicle || 'Not linked'}</dd></div><div><dt>VIN</dt><dd>{selected.vin || 'Not linked'}</dd></div><div><dt>Tag / plate</dt><dd>{selected.plate || 'Not linked'}</dd></div><div><dt>Method</dt><dd>{selected.method || provider(selected)}</dd></div><div><dt>Source</dt><dd>{selected.source || provider(selected)}</dd></div><div><dt>Reference</dt><dd>{selected.id}</dd></div></dl>{selected.notes ? <section className="detail-note"><span>Notes</span><p>{selected.notes}</p></section> : null}</div>
    </div>}</section>
  </main>;
}
