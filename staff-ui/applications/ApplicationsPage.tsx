import { useEffect, useMemo, useState } from 'react';
import { approveApplication, loadApplications, reviewApplication } from '../api';
import type { ApplicationItem } from '../types';
import { dateTime, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';

type Filter = 'review' | 'pickup' | 'history';
const filters: readonly Filter[] = ['review', 'pickup', 'history'];

export function ApplicationsPage({ onOpenRental }: { onOpenRental: (rentalId: string) => void }) {
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [counts, setCounts] = useState({ review: 0, scheduledPickup: 0, history: 0 });
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<Filter>('review');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try { const feed = await loadApplications(signal, force); setItems(feed.items || []); setCounts(feed.counts || { review: 0, scheduledPickup: 0, history: 0 }); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const events = new EventSource('/api/events'); events.addEventListener('platform', (event: MessageEvent) => { try { const payload = JSON.parse(event.data || '{}'); if ((payload.topics || []).some((topic: string) => ['applications', 'payments', 'assignments'].includes(topic))) void refresh(undefined, true); } catch { /* next event repairs the view */ } }); return () => { controller.abort(); events.close(); }; }, []);

  const visible = useMemo(() => items.filter(item => {
    const history = /denied|removed|cancelled|completed|pickup confirmed/i.test(item.status || '');
    if (filter === 'history' && !history) return false;
    if (filter === 'pickup' && (!item.paid || history)) return false;
    if (filter === 'review' && (item.paid || history)) return false;
    return wordsMatch(query, [item.name, item.vehicle, item.status, item.pickupDate]);
  }), [items, query, filter]);
  const selected = items.find(row => row.id === selectedId) || null;

  const approve = async () => {
    if (!selected || working) return; setWorking(true); setError(''); setNotice('');
    try { const result = await approveApplication(selected.id); setNotice(result.warning || 'Approved. Secure onboarding is ready for the customer.'); await refresh(undefined, true); }
    catch (requestError) { setError((requestError as Error).message); }
    finally { setWorking(false); }
  };
  const decide = async (decision: 'deny' | 'restore') => {
    if (!selected || working) return;
    if (decision === 'deny' && !window.confirm(`Archive ${selected.name}'s application? No paid application can be archived by this command.`)) return;
    setWorking(true); setError(''); setNotice('');
    try { await reviewApplication(selected.id, decision, notes); setNotice(decision === 'deny' ? 'Application archived.' : 'Application restored to review.'); setNotes(''); await refresh(undefined, true); }
    catch (requestError) { setError((requestError as Error).message); }
    finally { setWorking(false); }
  };

  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  return <main className={`operations-workspace resource-workspace ${selected ? 'has-detail' : ''}`}>
    <section className="operations-index"><header className="workspace-title"><div><span>Newest activity first</span><h1>Applications</h1></div></header>
      <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Application status" {...filterSwipe}><button role="tab" aria-selected={filter === 'review'} className={filter === 'review' ? 'active' : ''} onClick={() => setFilter('review')}><span>Review</span><strong>{counts.review}</strong></button><button role="tab" aria-selected={filter === 'pickup'} className={filter === 'pickup' ? 'active' : ''} onClick={() => setFilter('pickup')}><span>Paid pickup</span><strong>{counts.scheduledPickup}</strong></button><button role="tab" aria-selected={filter === 'history'} className={filter === 'history' ? 'active' : ''} onClick={() => setFilter('history')}><span>History</span><strong>{counts.history}</strong></button></div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search applicant, vehicle, status" /></label>
      {error && !selected ? <div className="inline-alert error">{error}</div> : null}
      <div className="record-list">{loading ? <div className="empty-state">Loading applications...</div> : null}{!loading && !visible.length ? <div className="empty-state">No applications match this view.</div> : null}{visible.map(item => <button key={item.id} className={item.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => { setSelectedId(item.id); setNotice(''); setError(''); }}><span className={`status-line ${statusTone(item.paid ? 'paid' : item.status)}`} /><span className="record-main"><strong>{item.name}</strong><span>{item.vehicle || 'Vehicle not selected'}</span></span><span className="record-side"><b>{item.paid ? 'Paid' : item.status || 'New'}</b><time>{dateTime(item.lastActivityAt)}</time></span></button>)}</div>
    </section>
    <section className="operations-detail">{!selected ? <div className="detail-empty"><strong>Select an application</strong><span>Review progress without reserving a vehicle before payment.</span></div> : <div className="static-detail"><header className="detail-header"><button className="detail-back" onClick={() => setSelectedId('')}>Back</button><div><span>Application</span><h2>{selected.name}</h2></div><em className={`status-chip ${statusTone(selected.paid ? 'paid' : selected.status)}`}>{selected.paid ? 'Paid' : selected.status || 'New'}</em></header>
      <div className="detail-scroll">{error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}<section className="application-progress"><div><span>Vehicle</span><strong>{selected.vehicle || 'Not selected'}</strong></div><div><span>Last activity</span><strong>{dateTime(selected.lastActivityAt)}</strong></div><div><span>Payment</span><strong>{selected.paid ? 'Verified' : 'Not paid'}</strong></div><div><span>Pickup</span><strong>{selected.scheduledPickup ? `${selected.pickupDate || ''} ${selected.pickupTime || ''}`.trim() : 'Not scheduled'}</strong></div></section>
        <label className="review-notes">Review note<textarea rows={5} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Private reason or instructions for this decision" /></label>
      </div><footer className="detail-actions">{selected.rentalFileId ? <button className="primary-command" onClick={() => onOpenRental(selected.rentalFileId || '')}>Open Rental File</button> : null}{!selected.paid && !/denied|removed|cancelled/i.test(selected.status || '') ? <button className="primary-command" onClick={approve} disabled={working}>{working ? 'Working...' : 'Approve and prepare onboarding'}</button> : null}{!selected.paid && !/denied|removed|cancelled/i.test(selected.status || '') ? <button className="danger-command" onClick={() => void decide('deny')} disabled={working}>Archive</button> : null}{/denied|removed|cancelled/i.test(selected.status || '') ? <button className="secondary-command" onClick={() => void decide('restore')} disabled={working}>Restore review</button> : null}</footer>
    </div>}</section>
  </main>;
}
