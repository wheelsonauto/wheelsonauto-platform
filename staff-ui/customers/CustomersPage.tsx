import { FormEvent, useEffect, useMemo, useState } from 'react';
import { loadCustomers, updateCustomer } from '../api';
import type { CustomerRecord } from '../types';
import { money, shortDate, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';

type Filter = 'active' | 'setup' | 'history';
const filters: readonly Filter[] = ['active', 'setup', 'history'];

function isHistory(customer: CustomerRecord) { return /history|ended|removed|inactive|returned/i.test([customer.status, customer.stage].join(' ')); }

export function CustomersPage({ onNavigate, onOpenRental }: { onNavigate: (workspace: string) => void; onOpenRental: (rentalId: string) => void }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<CustomerRecord | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try { const feed = await loadCustomers(signal, force); setCustomers(feed.records || []); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const events = new EventSource('/api/events'); events.addEventListener('platform', () => void refresh(undefined, true)); return () => { controller.abort(); events.close(); }; }, []);
  useEffect(() => { const customer = customers.find(row => row.id === selectedId); if (customer) setDraft({ ...customer }); }, [selectedId, customers]);

  const visible = useMemo(() => customers.filter(customer => {
    const history = isHistory(customer);
    const setup = !history && /setup|pending|application|onboarding/i.test([customer.status, customer.stage].join(' '));
    if (filter === 'history' && !history) return false;
    if (filter === 'setup' && !setup) return false;
    if (filter === 'active' && (history || setup)) return false;
    return wordsMatch(query, [customer.name, customer.phone, customer.email, customer.vehicle, customer.vin, customer.licensePlate, customer.status]);
  }), [customers, query, filter]);

  const counts = {
    active: customers.filter(row => !isHistory(row) && !/setup|pending|application|onboarding/i.test([row.status, row.stage].join(' '))).length,
    setup: customers.filter(row => !isHistory(row) && /setup|pending|application|onboarding/i.test([row.status, row.stage].join(' '))).length,
    history: customers.filter(isHistory).length
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || saving) return; setSaving(true); setError(''); setNotice('');
    try {
      const result = await updateCustomer(draft.id, { expectedUpdatedAt: draft.updatedAt, phone: draft.phone, email: draft.email, address: draft.address, city: draft.city, state: draft.state, postalCode: draft.postalCode, notes: draft.notes });
      await refresh(undefined, true); setDraft(result.record); setNotice('Customer contact details updated across exact linked records.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  return <main className={`operations-workspace resource-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index swipe-zone" {...filterSwipe}>
      <header className="workspace-title"><div><span>Connected customer files</span><h1>Customers</h1></div></header>
      <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Customer status">{filters.map(key => <button role="tab" aria-selected={filter === key} key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{key[0].toUpperCase() + key.slice(1)}</span><strong>{counts[key]}</strong></button>)}</div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customer, vehicle, VIN, tag" /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      <div className="record-list">{loading ? <div className="empty-state">Loading customers...</div> : null}{!loading && !visible.length ? <div className="empty-state">No customers match this view.</div> : null}
        {visible.map(customer => <button key={customer.id} className={customer.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(customer.id)}><span className={`status-line ${statusTone(customer.status || customer.stage)}`} /><span className="record-main"><strong>{customer.name || 'Unnamed customer'}</strong><span>{customer.vehicle || customer.email || customer.phone || 'Customer file'}</span></span><span className="record-side"><b>{customer.status || customer.stage || 'Active'}</b><time>{customer.nextRun ? `Due ${shortDate(customer.nextRun)}` : customer.amount ? money(customer.amount) : ''}</time></span></button>)}
      </div>
    </section>
    <section className="operations-detail">{!draft ? <div className="detail-empty"><strong>Select a customer</strong><span>Contact, vehicle, and payment context stay in one file.</span></div> : <form onSubmit={submit}>
      <header className="detail-header"><button type="button" className="detail-back" onClick={() => { setDraft(null); setSelectedId(''); }}>Back</button><div><span>Customer file</span><h2>{draft.name || 'Customer'}</h2></div><em className={`status-chip ${statusTone(draft.status || draft.stage)}`}>{draft.status || draft.stage || 'Active'}</em></header>
      <div className="detail-scroll">{error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
        <section className="identity-summary"><div><span>Vehicle</span><strong>{draft.vehicle || 'Not assigned'}</strong></div><div><span>Next payment</span><strong>{draft.nextRun ? shortDate(draft.nextRun) : 'Not scheduled'}</strong></div></section>
        <div className="context-actions">{draft.activeRentalFileId ? <button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}>Open Rental File</button> : null}<button type="button" className="text-command" onClick={() => onNavigate('messages')}>Open messages</button><button type="button" className="text-command" onClick={() => onNavigate('payments')}>View payments</button></div>
        <div className="form-grid"><label>Phone<input value={draft.phone || ''} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label>Email<input type="email" value={draft.email || ''} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label><label className="span-2">Address<input value={draft.address || ''} onChange={event => setDraft({ ...draft, address: event.target.value })} /></label><label>City<input value={draft.city || ''} onChange={event => setDraft({ ...draft, city: event.target.value })} /></label><label>State<input value={draft.state || ''} onChange={event => setDraft({ ...draft, state: event.target.value })} /></label><label>Postal code<input value={draft.postalCode || ''} onChange={event => setDraft({ ...draft, postalCode: event.target.value })} /></label><label>VIN<input readOnly value={draft.vin || ''} /></label><label className="span-2">Notes<textarea rows={8} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label></div>
      </div><footer className="detail-actions"><button className="primary-command" disabled={saving}>{saving ? 'Saving...' : 'Save customer'}</button></footer>
    </form>}</section>
  </main>;
}
