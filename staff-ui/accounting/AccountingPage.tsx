import { useEffect, useMemo, useState } from 'react';
import { loadPayments } from '../api';
import type { PaymentRecord } from '../types';
import { money } from '../ui';

function monthKey(value?: string) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function AccountingPage() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal) => {
    try { const feed = await loadPayments(signal); setPayments(feed.records || []); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const events = new EventSource('/api/events'); events.addEventListener('platform', () => void refresh()); return () => { controller.abort(); events.close(); }; }, []);

  const rows = useMemo(() => payments.filter(payment => monthKey(payment.createdAt || payment.date) === period), [payments, period]);
  const paid = rows.filter(row => /paid|succeeded|complete/i.test(row.status || ''));
  const outside = paid.filter(row => /cash|zelle|cash app|money order|outside/i.test([row.method, row.source].join(' ')));
  const failed = rows.filter(row => /failed|declined|not found/i.test(row.status || ''));
  const bySource = useMemo(() => {
    const totals = new Map<string, { count: number; amount: number }>();
    paid.forEach(row => { const key = row.paymentProvider || row.provider || row.method || row.source || 'Recorded'; const current = totals.get(key) || { count: 0, amount: 0 }; current.count += 1; current.amount += Number(row.amount || 0); totals.set(key, current); });
    return [...totals.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [paid]);

  return <main className="report-workspace"><header className="page-heading"><div><span>Built-in books</span><h1>Accounting</h1><p>Collected money and exceptions from the same payment ledger.</p></div><label className="period-control">Period<input type="month" value={period} onChange={event => setPeriod(event.target.value)} /></label></header>
    {error ? <div className="inline-alert error">{error}</div> : null}
    <section className="metric-strip"><div><span>Collected</span><strong>{loading ? '...' : money(paid.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong><small>{paid.length} settled records</small></div><div><span>Outside app</span><strong>{money(outside.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong><small>{outside.length} records</small></div><div><span>Failed</span><strong>{failed.length}</strong><small>{money(failed.reduce((sum, row) => sum + Number(row.amount || 0), 0))} attempted</small></div><div><span>Average payment</span><strong>{paid.length ? money(paid.reduce((sum, row) => sum + Number(row.amount || 0), 0) / paid.length) : '$0.00'}</strong><small>settled records</small></div></section>
    <div className="report-grid"><section className="dashboard-panel"><header><div><span>Revenue</span><h2>Payment sources</h2></div><a className="text-command" href="/api/reports/deep.csv">Export CSV</a></header><div className="accounting-table"><div className="table-head"><span>Source</span><span>Records</span><span>Collected</span></div>{bySource.map(([source, total]) => <div key={source}><strong>{source}</strong><span>{total.count}</span><b>{money(total.amount)}</b></div>)}{!bySource.length ? <div className="empty-state compact">No settled payments in this period.</div> : null}</div></section>
      <section className="dashboard-panel"><header><div><span>File quality</span><h2>Reconciliation</h2></div></header><div className="reconcile-list"><div><span>Named customers</span><strong>{rows.filter(row => row.customer && !/unmatched|unknown/i.test(row.customer)).length}</strong></div><div><span>Unmatched</span><strong>{rows.filter(row => !row.customer || /unmatched|unknown/i.test(row.customer)).length}</strong></div><div><span>Vehicle linked</span><strong>{rows.filter(row => row.vehicleId || row.vin || row.plate).length}</strong></div><div><span>Needs attention</span><strong>{failed.length}</strong></div></div></section>
    </div>
  </main>;
}
