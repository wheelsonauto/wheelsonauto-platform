import { FormEvent, useEffect, useMemo, useState } from 'react';
import { loadVehicles, updateVehicle } from '../api';
import type { VehicleRecord } from '../types';
import { statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';

function title(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

type Filter = 'all' | 'available' | 'assigned' | 'service';
const filters: readonly Filter[] = ['all', 'available', 'assigned', 'service'];

export function FleetPage({ onOpenRental }: { onOpenRental: (rentalId: string) => void }) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<VehicleRecord | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try { const feed = await loadVehicles(signal, force); setVehicles(feed.records || []); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController(); void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', (event: MessageEvent) => { try { const payload = JSON.parse(event.data || '{}'); if ((payload.topics || []).includes('assignments')) void refresh(undefined, true); } catch { /* next event repairs the view */ } });
    return () => { controller.abort(); events.close(); };
  }, []);

  useEffect(() => { const vehicle = vehicles.find(row => row.id === selectedId); if (vehicle) setDraft({ ...vehicle }); }, [selectedId, vehicles]);

  const visible = useMemo(() => vehicles.filter(vehicle => {
    const status = String(vehicle.status || '').toLowerCase();
    if (filter === 'available' && !/ready|available|online|in lot/.test(status)) return false;
    if (filter === 'assigned' && !/assigned|rented/.test(status)) return false;
    if (filter === 'service' && !/service|repair|prep|review/.test(status)) return false;
    return wordsMatch(query, [title(vehicle), vehicle.vin, vehicle.plate, vehicle.stock, vehicle.tracker, vehicle.currentCustomer, vehicle.status]);
  }), [vehicles, query, filter]);

  const counts = {
    all: vehicles.length,
    available: vehicles.filter(row => /ready|available|online|in lot/i.test(row.status || '')).length,
    assigned: vehicles.filter(row => /assigned|rented/i.test(row.status || '')).length,
    service: vehicles.filter(row => /service|repair|prep|review/i.test(row.status || '')).length
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await updateVehicle(draft.id, {
        expectedUpdatedAt: draft.updatedAt, plate: draft.plate, stock: draft.stock, tempTag: draft.tempTag,
        tracker: draft.tracker, color: draft.color, location: draft.location, mileage: draft.mileage, notes: draft.notes
      });
      await refresh(undefined, true); setDraft(result.record); setNotice('Vehicle file updated everywhere it is linked.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  return <main className={`operations-workspace resource-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index swipe-zone" {...filterSwipe}>
      <header className="workspace-title"><div><span>Inventory and assignments</span><h1>Fleet</h1></div></header>
      <div className="compact-metrics four swipe-tabs" role="tablist" aria-label="Fleet status">{filters.map(key => <button role="tab" aria-selected={filter === key} key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{key === 'all' ? 'All' : key[0].toUpperCase() + key.slice(1)}</span><strong>{counts[key]}</strong></button>)}</div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search vehicle, VIN, tag, tracker, customer" /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      {!loading && visible.length ? <div className="record-table-head vehicle-table-head"><span /><span>Vehicle</span><span>Assignment</span><span>Status / mileage</span></div> : null}
      <div className="record-list vehicle-records">
        {loading ? <div className="empty-state">Loading fleet...</div> : null}
        {!loading && !visible.length ? <div className="empty-state">No vehicles match this view.</div> : null}
        {visible.map(vehicle => <button key={vehicle.id} className={vehicle.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(vehicle.id)}>
          <span className={`status-line ${statusTone(vehicle.status)}`} />
          <span className="record-main"><strong>{title(vehicle)}</strong><span>{[vehicle.plate || vehicle.stock, vehicle.vin].filter(Boolean).join(' | ') || 'Identity review needed'}</span></span>
          <span className="record-context"><strong>{vehicle.currentCustomer || 'Unassigned'}</strong><span>{vehicle.tracker || vehicle.location || 'Tracker not linked'}</span></span>
          <span className="record-side"><b>{vehicle.status || 'Status not set'}</b><time>{vehicle.mileage ? `${Number(vehicle.mileage).toLocaleString()} mi` : 'Mileage not set'}</time></span>
        </button>)}
      </div>
    </section>
    <section className="operations-detail">
      {!draft ? <div className="detail-empty"><strong>Select a vehicle</strong><span>Identity, assignment, and condition stay together.</span></div> : <form onSubmit={submit}>
        <header className="detail-header"><button type="button" className="detail-back" onClick={() => { setDraft(null); setSelectedId(''); }}>Back</button><div><span>Vehicle file</span><h2>{title(draft)}</h2></div><em className={`status-chip ${statusTone(draft.status)}`}>{draft.status || 'Unclassified'}</em></header>
        <div className="detail-scroll">
          {error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
          <section className="identity-summary"><div><span>VIN</span><strong>{draft.vin || 'Missing'}</strong></div><div><span>Current customer</span><strong>{draft.currentCustomer || 'Unassigned'}</strong></div></section>
          {draft.activeRentalFileId ? <div className="context-actions"><button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}>Open Rental File</button></div> : null}
          <div className="form-grid">
            <label>Permanent tag<input value={draft.plate || ''} onChange={event => setDraft({ ...draft, plate: event.target.value })} /></label>
            <label>Stock / temp tag<input value={draft.stock || draft.tempTag || ''} onChange={event => setDraft({ ...draft, stock: event.target.value })} /></label>
            <label>Tracker<input value={draft.tracker || ''} onChange={event => setDraft({ ...draft, tracker: event.target.value })} /></label>
            <label>Mileage<input type="number" min="0" step="1" value={draft.mileage || ''} onChange={event => setDraft({ ...draft, mileage: event.target.value })} /></label>
            <label>Color<input value={draft.color || ''} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label>
            <label>Location<input value={draft.location || ''} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
            <label className="span-2">Notes<textarea rows={7} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
          </div>
        </div>
        <footer className="detail-actions"><button className="primary-command" disabled={saving}>{saving ? 'Saving...' : 'Save vehicle'}</button></footer>
      </form>}
    </section>
  </main>;
}
