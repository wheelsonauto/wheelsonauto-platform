import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CarFront, Globe2, RotateCcw, UserRoundPlus } from 'lucide-react';
import { assignCustomerVehicle, loadCustomers, loadVehicles, updateVehicle, updateVehicleState } from '../api';
import type { CustomerRecord, VehicleRecord } from '../types';
import { statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { useViewedRecords } from '../useViewedRecords';

function title(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

type Filter = 'all' | 'available' | 'assigned' | 'service';
type FleetState = 'online' | 'offline' | 'ready' | 'prep' | 'service' | 'returned';
const filters: readonly Filter[] = ['all', 'available', 'assigned', 'service'];

function isHistoryCustomer(customer: CustomerRecord) {
  return /history|ended|removed|inactive|returned/i.test([customer.status, customer.stage].join(' '));
}

export function FleetPage({ role, onNavigate, onOpenRental }: { role: 'owner' | 'manager' | 'mechanic'; onNavigate: (workspace: string) => void; onOpenRental: (rentalId: string) => void }) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<VehicleRecord | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fleetState, setFleetState] = useState<FleetState>('ready');
  const [stateConfirmed, setStateConfirmed] = useState(false);
  const [assignmentCustomerId, setAssignmentCustomerId] = useState('');
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const [assignmentReason, setAssignmentReason] = useState('Vehicle assigned from Fleet by staff.');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try { const [feed, customerFeed] = await Promise.all([loadVehicles(signal, force), role === 'mechanic' ? Promise.resolve(null) : loadCustomers(signal, force)]); setVehicles(feed.records || []); if (customerFeed) setCustomers(customerFeed.records || []); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController(); void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', (event: MessageEvent) => { try { const payload = JSON.parse(event.data || '{}'); if ((payload.topics || []).includes('assignments')) void refresh(undefined, true); } catch { /* next event repairs the view */ } });
    return () => { controller.abort(); events.close(); };
  }, []);

  useEffect(() => { const vehicle = vehicles.find(row => row.id === selectedId); if (vehicle) { setDraft({ ...vehicle }); const state = String(vehicle.status || '').toLowerCase(); setFleetState((['online', 'offline', 'ready', 'prep', 'service', 'returned'].includes(state) ? state : 'ready') as FleetState); } }, [selectedId, vehicles]);

  const viewed = useViewedRecords('fleet', vehicles, !loading);

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
  const openVehicle = (vehicle: VehicleRecord) => {
    viewed.markViewed(vehicle.id);
    setSelectedId(vehicle.id);
    setDraft({ ...vehicle });
    setStateConfirmed(false);
    setAssignmentConfirmed(false);
    setAssignmentCustomerId('');
  };

  const saveFleetState = async () => {
    if (!draft || !stateConfirmed || saving) { setError('Confirm the exact vehicle and fleet state first.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await updateVehicleState(draft.id, { status: fleetState, expectedUpdatedAt: draft.updatedAt });
      await refresh(undefined, true); setDraft(result.record); setStateConfirmed(false); setNotice(fleetState === 'online' ? 'Vehicle published online and marked available.' : `Vehicle moved to ${result.record.status || fleetState}.`);
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const assignVehicle = async () => {
    if (!draft || !assignmentCustomerId || !assignmentConfirmed || saving) { setError('Choose and confirm the exact customer assignment.'); return; }
    const customer = customers.find(row => row.id === assignmentCustomerId);
    if (!customer) { setError('The selected customer was not found.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await assignCustomerVehicle(customer.id, { vehicleId: draft.id, expectedUpdatedAt: customer.updatedAt, reason: assignmentReason });
      await refresh(undefined, true); setDraft(result.vehicle); setAssignmentConfirmed(false); setNotice(result.unchanged ? 'That exact assignment was already saved.' : `Assigned to ${result.customer.name || 'customer'} across ${result.propagated.length} linked records.`);
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  return <main className={`operations-workspace resource-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index swipe-zone" {...filterSwipe}>
      <header className="workspace-title"><div><span>Inventory and assignments</span><h1>Fleet</h1></div>{viewed.unreadCount ? <button type="button" className="unread-summary" onClick={viewed.markAllViewed}>{viewed.unreadCount} new</button> : null}</header>
      <div className="compact-metrics four swipe-tabs" role="tablist" aria-label="Fleet status">{filters.map(key => <button type="button" role="tab" aria-selected={filter === key} key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{key === 'all' ? 'All' : key[0].toUpperCase() + key.slice(1)}</span><strong>{counts[key]}</strong></button>)}</div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search vehicle, VIN, tag, tracker, customer" /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      {!loading && visible.length ? <div className="record-table-head vehicle-table-head"><span /><span>Vehicle</span><span>Assignment</span><span>Status / mileage</span></div> : null}
      <div className="record-list vehicle-records">
        {loading ? <div className="empty-state">Loading fleet...</div> : null}
        {!loading && !visible.length ? <div className="empty-state">No vehicles match this view.</div> : null}
        {visible.map(vehicle => <button type="button" key={vehicle.id} className={`${vehicle.id === selectedId ? 'record-row active' : 'record-row'}${viewed.unreadIds.has(vehicle.id) ? ' unread-record' : ''}`} onClick={() => openVehicle(vehicle)} aria-label={`Open ${title(vehicle)} vehicle file`}>
          {viewed.unreadIds.has(vehicle.id) ? <span className="record-unread-dot" aria-label="Unviewed" /> : <span className={`status-line ${statusTone(vehicle.status)}`} />}
          <span className="record-main"><strong>{title(vehicle)}</strong><span>{[vehicle.plate || vehicle.stock, vehicle.vin].filter(Boolean).join(' | ') || 'Identity review needed'}</span></span>
          <span className="record-context"><strong>{vehicle.currentCustomer || 'Unassigned'}</strong><span>{vehicle.tracker || vehicle.location || 'Tracker not linked'}</span></span>
          <span className="record-side"><b>{vehicle.status || 'Status not set'}</b><time>{vehicle.mileage ? `${Number(vehicle.mileage).toLocaleString()} mi` : 'Mileage not set'}</time></span>
        </button>)}
      </div>
    </section>
    <section className="operations-detail">
      {!draft ? <div className="detail-empty"><strong>Select a vehicle</strong><span>Identity, assignment, and condition stay together.</span></div> : role === 'mechanic' ? <section className="read-only-detail mechanic-vehicle-detail">
        <header className="detail-header"><button type="button" className="detail-back" onClick={() => { setDraft(null); setSelectedId(''); }}>Back</button><div><span>Vehicle reference</span><h2>{title(draft)}</h2></div><em className={`status-chip ${statusTone(draft.status)}`}>{draft.status || 'Unclassified'}</em></header>
        <div className="detail-scroll"><div className="read-only-facts"><div><span>VIN</span><strong>{draft.vin || 'Missing'}</strong></div><div><span>Tag / stock</span><strong>{draft.plate || draft.stock || draft.tempTag || 'Missing'}</strong></div><div><span>Tracker</span><strong>{draft.tracker || 'Not linked'}</strong></div><div><span>Mileage</span><strong>{draft.mileage ? `${Number(draft.mileage).toLocaleString()} mi` : 'Not recorded'}</strong></div><div><span>Current renter</span><strong>{draft.currentCustomer || 'Unassigned'}</strong></div><div><span>Location</span><strong>{draft.location || 'Not recorded'}</strong></div></div>{draft.notes ? <article className="read-only-note"><span>Vehicle notes</span><p>{draft.notes}</p></article> : null}</div>
        <footer className="detail-actions"><button type="button" className="primary-command" onClick={() => onNavigate('maintenance')}>Open maintenance</button><button type="button" className="secondary-command" onClick={() => onNavigate('dispatch')}>Open work queue</button></footer>
      </section> : <form onSubmit={submit}>
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
          <section className="fleet-state-editor"><header><div><span>Fleet availability</span><strong>Online, offline, and lot status</strong></div><Globe2 size={19} /></header>{draft.currentCustomer || draft.activeRentalFileId ? <div className="inline-alert"><strong>{draft.currentCustomer || 'Active renter'} is assigned.</strong> Complete the Rental File return before moving this car back online, Ready, Prep, Service, or Returned.</div> : <><label>Status<select value={fleetState} onChange={event => { setFleetState(event.target.value as FleetState); setStateConfirmed(false); }}><option value="online">Online and available</option><option value="offline">Offline</option><option value="ready">Ready</option><option value="prep">Prep</option><option value="service">Service</option><option value="returned">Returned</option></select></label>{fleetState === 'online' && !draft.onlineListingId ? <div className="inline-alert error">Website listing setup is required before this vehicle can be published online.</div> : null}<label className="sensitive-confirmation"><input type="checkbox" checked={stateConfirmed} onChange={event => setStateConfirmed(event.target.checked)} /><span><strong>I confirmed this exact vehicle and state.</strong><small>Online publishes the linked listing. Every other state removes it from the public inventory.</small></span></label><button type="button" className="secondary-command" disabled={saving || !stateConfirmed || fleetState === 'online' && !draft.onlineListingId} onClick={saveFleetState}>{saving ? 'Updating...' : 'Update fleet state'}</button></>}</section>
          <section className="assignment-editor"><header><div><span>Customer assignment</span><strong>{draft.currentCustomer ? 'Current renter' : 'Assign or swap'}</strong></div><UserRoundPlus size={19} /></header>{draft.currentCustomer ? <><div className="assignment-current"><CarFront size={18} /><span><strong>{draft.currentCustomer}</strong><small>{draft.activeRentalFileId ? 'Use the Rental File for return, mileage, and autopay closure.' : 'Review the customer file before changing this assignment.'}</small></span></div><div className="context-actions">{draft.activeRentalFileId ? <button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}><RotateCcw size={15} /> Complete return</button> : null}<button type="button" className="text-command" onClick={() => onNavigate('customers')}>Open customer files</button></div></> : <><label>Exact customer<select value={assignmentCustomerId} onChange={event => { setAssignmentCustomerId(event.target.value); setAssignmentConfirmed(false); }}><option value="">Choose customer</option>{customers.filter(customer => !isHistoryCustomer(customer)).map(customer => <option key={customer.id} value={customer.id}>{[customer.name, customer.vehicle ? `Current: ${customer.vehicle}` : 'No vehicle', customer.phone || customer.email].filter(Boolean).join(' | ')}</option>)}</select></label><label>Reason<input value={assignmentReason} onChange={event => setAssignmentReason(event.target.value)} /></label><label className="sensitive-confirmation"><input type="checkbox" checked={assignmentConfirmed} onChange={event => setAssignmentConfirmed(event.target.checked)} /><span><strong>I confirmed the customer and exact vehicle.</strong><small>If the customer already has a car, this performs a connected vehicle swap and records the history.</small></span></label><button type="button" className="secondary-command" disabled={saving || !assignmentConfirmed || !assignmentCustomerId} onClick={assignVehicle}>{saving ? 'Assigning...' : 'Assign vehicle'}</button></>}</section>
        </div>
        <footer className="detail-actions"><button className="primary-command" disabled={saving}>{saving ? 'Saving...' : 'Save vehicle'}</button></footer>
      </form>}
    </section>
  </main>;
}
