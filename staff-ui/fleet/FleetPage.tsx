import { ChangeEvent, FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Camera, CarFront, Globe2, Plus, RotateCcw, Trash2, UserRoundPlus } from 'lucide-react';
import {
  archiveVehicle,
  assignCustomerVehicle,
  completeRentalReturn,
  createVehicle,
  loadCustomers,
  loadMaintenance,
  loadVehicles,
  removeVehiclePhoto,
  updateVehicle,
  updateVehicleState,
  uploadVehiclePhoto
} from '../api';
import type { CustomerRecord, MaintenanceRecord, VehicleRecord } from '../types';
import { dateTime, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { useViewedRecords } from '../useViewedRecords';

function title(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isClosed(job: MaintenanceRecord) {
  return /complete|fixed|closed|superseded|cancelled|canceled|duplicate/i.test(job.status || '');
}

function isArchived(vehicle: VehicleRecord) {
  return /removed|retired|sold|history|archived/i.test(vehicle.status || '') || !!vehicle.removedAt;
}

function isHistoryCustomer(customer: CustomerRecord) {
  return /history|ended|removed|inactive|returned/i.test([customer.status, customer.stage].join(' '));
}

function belongsToVehicle(job: MaintenanceRecord, vehicle: VehicleRecord) {
  if (job.vehicleId && String(job.vehicleId) === String(vehicle.id)) return true;
  if (job.vin && vehicle.vin && String(job.vin).toLowerCase() === String(vehicle.vin).toLowerCase()) return true;
  return !!(job.vehicle && title(vehicle) && String(job.vehicle).toLowerCase() === title(vehicle).toLowerCase());
}

function serviceDue(vehicle: VehicleRecord, jobs: MaintenanceRecord[]) {
  if (/service|repair/i.test(vehicle.status || '')) return true;
  return jobs.some(job => belongsToVehicle(job, vehicle) && !isClosed(job) && (
    (!!vehicle.currentCustomer || !!vehicle.activeRentalFileId || !/inspection|monthly|oil change|scheduled maintenance|routine maintenance/i.test([job.type, job.issue].join(' '))) && !!(job.due || job.nextDue) && String(job.due || job.nextDue) <= todayKey()
    || /customer requested|in progress|waiting for part|unsafe|needs attention/i.test([job.status, job.inspectionCondition].join(' '))
  ));
}

function emptyVehicle(): VehicleRecord {
  return { id: '', year: '', make: '', model: '', vin: '', plate: '', stock: '', tracker: '', color: '', mileage: '', location: 'WheelsonAuto lot', notes: '', status: 'Ready' };
}

async function photoPayload(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('The photo could not be read.')); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, size: file.size, dataUrl };
}

type Filter = 'fleet' | 'lot' | 'service' | 'history';
type FleetState = 'online' | 'offline' | 'ready' | 'prep' | 'service' | 'returned';
type VehicleDetailTab = 'edit' | 'photos' | 'service' | 'renter' | 'history';
const filters: readonly Filter[] = ['fleet', 'lot', 'service', 'history'];
const filterLabels: Record<Filter, string> = { fleet: 'Fleet', lot: 'In lot', service: 'Service due', history: 'History' };
const vehicleDetailTabs: Array<{ id: VehicleDetailTab; label: string }> = [
  { id: 'edit', label: 'Vehicle' }, { id: 'photos', label: 'Photos' }, { id: 'service', label: 'Service' }, { id: 'renter', label: 'Renter' }, { id: 'history', label: 'History' }
];
const FleetServicePanel = lazy(() => import('./FleetServicePanel'));

export function FleetPage({ role, initialSection = '', onNavigate, onOpenRental }: { role: 'owner' | 'manager' | 'mechanic'; initialSection?: string; onNavigate: (workspace: string) => void; onOpenRental: (rentalId: string) => void }) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [jobs, setJobs] = useState<MaintenanceRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<VehicleRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [pricing, setPricing] = useState({ weeklyPayment: '', downPayment: '' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(initialSection === 'service' ? 'service' : initialSection === 'history' ? 'history' : 'fleet');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fleetState, setFleetState] = useState<FleetState>('ready');
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [assignmentCustomerId, setAssignmentCustomerId] = useState('');
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const [assignmentReason, setAssignmentReason] = useState('Vehicle assigned from Fleet by staff.');
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [detailTab, setDetailTab] = useState<VehicleDetailTab>('edit');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnConfirmed, setReturnConfirmed] = useState(false);
  const [returnDraft, setReturnDraft] = useState({ endDate: todayKey(), endingMileage: '', vehicleStatus: 'Ready' as 'Ready' | 'Prep' | 'Service', reason: '' });

  useEffect(() => {
    if (initialSection === 'service' || initialSection === 'history') setFilter(initialSection);
  }, [initialSection]);

  const canManage = role !== 'mechanic';
  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [vehicleFeed, customerFeed, maintenanceFeed] = await Promise.all([
        loadVehicles(signal, force), role === 'mechanic' ? Promise.resolve(null) : loadCustomers(signal, force), loadMaintenance(signal, force)
      ]);
      setVehicles(vehicleFeed.records || []);
      if (customerFeed) setCustomers(customerFeed.records || []);
      setJobs(maintenanceFeed.records || []);
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).some((topic: string) => ['assignments', 'service', 'vehicles'].includes(topic))) void refresh(undefined, true);
      } catch { /* A later event repairs the view. */ }
    });
    return () => { controller.abort(); events.close(); };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const vehicle = vehicles.find(row => row.id === selectedId);
    if (!vehicle) return;
    setDraft({ ...vehicle });
    const state = String(vehicle.status || '').toLowerCase();
    setFleetState((['online', 'offline', 'ready', 'prep', 'service', 'returned'].includes(state) ? state : 'ready') as FleetState);
  }, [selectedId, vehicles]);

  const viewed = useViewedRecords('fleet', vehicles, !loading);
  const visible = useMemo(() => vehicles.filter(vehicle => {
    const archived = isArchived(vehicle);
    if (filter === 'history' && !archived) return false;
    if (filter !== 'history' && archived) return false;
    if (filter === 'lot' && (vehicle.currentCustomer || serviceDue(vehicle, jobs))) return false;
    if (filter === 'service' && !serviceDue(vehicle, jobs)) return false;
    return wordsMatch(query, [title(vehicle), vehicle.vin, vehicle.plate, vehicle.stock, vehicle.tracker, vehicle.currentCustomer, vehicle.status]);
  }), [vehicles, jobs, query, filter]);

  const counts = useMemo(() => ({
    fleet: vehicles.filter(vehicle => !isArchived(vehicle)).length,
    lot: vehicles.filter(vehicle => !isArchived(vehicle) && !vehicle.currentCustomer && !serviceDue(vehicle, jobs)).length,
    service: vehicles.filter(vehicle => !isArchived(vehicle) && serviceDue(vehicle, jobs)).length,
    history: vehicles.filter(isArchived).length
  }), [vehicles, jobs]);

  const selectedJobs = useMemo(() => draft ? jobs.filter(job => belongsToVehicle(job, draft)).sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || (Date.parse(b.fixedAt || b.completedAt || b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.fixedAt || a.completedAt || a.updatedAt || a.createdAt || '') || 0)) : [], [draft, jobs]);
  const openJobs = useMemo(() => selectedJobs.filter(job => !isClosed(job)), [selectedJobs]);
  const completedJobs = useMemo(() => selectedJobs.filter(isClosed), [selectedJobs]);
  const activePhotos = useMemo(() => draft ? Array.from(new Set(draft.imageUrls || [])).map(url => ({ url, artifact: (draft.photoArtifacts || []).find(photo => photo.url === url && !photo.removedAt) })) : [], [draft]);
  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  const closeDetail = () => {
    setDraft(null); setSelectedId(''); setCreating(false); setDetailTab('edit'); setPendingPhotos([]); setError(''); setNotice(''); setArchiveConfirmed(false); setReturnOpen(false); setReturnConfirmed(false);
  };

  const openVehicle = (vehicle: VehicleRecord) => {
    viewed.markViewed(vehicle.id);
    setSelectedId(vehicle.id); setDraft({ ...vehicle }); setCreating(false); setDetailTab('edit'); setArchiveConfirmed(false);
    setAssignmentConfirmed(false); setAssignmentCustomerId(''); setReturnOpen(false); setReturnConfirmed(false); setReturnDraft({ endDate: todayKey(), endingMileage: String(vehicle.mileage || ''), vehicleStatus: 'Ready', reason: '' }); setError(''); setNotice('');
  };

  const openNew = () => {
    setSelectedId(''); setDraft(emptyVehicle()); setCreating(true); setDetailTab('edit'); setPricing({ weeklyPayment: '', downPayment: '' }); setPendingPhotos([]); setError(''); setNotice('');
  };

  const saveVehicle = async () => {
    if (!draft || saving || !canManage) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (creating) {
        const result = await createVehicle({ ...draft, weeklyPayment: Number(pricing.weeklyPayment || 0), downPayment: Number(pricing.downPayment || 0) });
        let savedRecord = result.record;
        let uploaded = 0;
        for (const file of pendingPhotos) {
          try {
            const upload = await uploadVehiclePhoto(savedRecord.id, { expectedUpdatedAt: savedRecord.updatedAt, file: await photoPayload(file) });
            savedRecord = upload.record; uploaded += 1;
          } catch (photoError) {
            setError(`Vehicle was added, but ${file.name} did not upload: ${(photoError as Error).message}`);
            break;
          }
        }
        await refresh(undefined, true); setSelectedId(savedRecord.id); setDraft(savedRecord); setCreating(false); setPendingPhotos([]); setNotice(`Vehicle added to Fleet${uploaded ? ` with ${uploaded} photo${uploaded === 1 ? '' : 's'}` : ''}. Its website listing remains offline until you publish it.`);
      } else {
        const result = await updateVehicle(draft.id, {
          expectedUpdatedAt: draft.updatedAt, name: draft.name, year: draft.year, make: draft.make, model: draft.model, vin: draft.vin,
          plate: draft.plate, stock: draft.stock, tempTag: draft.tempTag, tracker: draft.tracker, color: draft.color,
          location: draft.location, mileage: draft.mileage, notes: draft.notes
        });
        await refresh(undefined, true); setDraft(result.record); setNotice('Vehicle file saved everywhere it is linked.');
      }
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  const saveFleetState = async () => {
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await updateVehicleState(draft.id, { status: fleetState, expectedUpdatedAt: draft.updatedAt });
      await refresh(undefined, true); setDraft(result.record); setNotice(fleetState === 'online' ? 'Vehicle published online and marked available.' : `Vehicle moved to ${result.record.status || fleetState}.`);
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  const assignVehicle = async () => {
    if (!draft || !assignmentCustomerId || !assignmentConfirmed || saving) { setError('Choose and confirm the exact customer assignment.'); return; }
    const customer = customers.find(row => row.id === assignmentCustomerId);
    if (!customer) { setError('The selected customer was not found.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await assignCustomerVehicle(customer.id, { vehicleId: draft.id, expectedUpdatedAt: customer.updatedAt, reason: assignmentReason, replaceExistingCustomer: !!draft.currentCustomer });
      await refresh(undefined, true); setDraft(result.vehicle); setAssignmentConfirmed(false); setNotice(result.unchanged ? 'That exact assignment was already saved.' : `Assigned to ${result.customer.name || 'customer'} across ${result.propagated.length} linked records.`);
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!draft || !files.length || saving) return;
    if (files.some(file => !/^image\/(jpeg|png)$/i.test(file.type) || file.size > 5 * 1024 * 1024)) { setError('Every photo must be a JPG or PNG no larger than 5 MB.'); return; }
    if (creating) {
      const seen = new Set<string>();
      const next = [...pendingPhotos, ...files].filter(file => {
        const key = [file.name, file.size, file.lastModified].join(':');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setPendingPhotos(next); setError(''); setNotice(`${next.length} photo${next.length === 1 ? '' : 's'} ready to upload with this car.`); return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      let savedRecord = draft;
      for (const file of files) {
        const result = await uploadVehiclePhoto(savedRecord.id, { expectedUpdatedAt: savedRecord.updatedAt, file: await photoPayload(file) });
        savedRecord = result.record;
      }
      await refresh(undefined, true); setDraft(savedRecord); setNotice(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded to this vehicle and its website gallery.`);
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  const deletePhoto = async (photoId: string, photoUrl: string) => {
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await removeVehiclePhoto(draft.id, photoId, photoUrl, draft.updatedAt);
      await refresh(undefined, true); setDraft(result.record); setNotice('Photo removed from the vehicle and website gallery.');
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  const submitReturn = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft?.activeRentalFileId || !returnConfirmed || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await completeRentalReturn(draft.activeRentalFileId, { endDate: returnDraft.endDate, endingMileage: Number(returnDraft.endingMileage), vehicleStatus: returnDraft.vehicleStatus, reason: returnDraft.reason });
      await refresh(undefined, true);
      if (result.vehicle) setDraft(current => current ? { ...current, ...result.vehicle, currentCustomer: '', activeRentalFileId: '' } : current);
      setReturnOpen(false); setReturnConfirmed(false); setNotice(`Return completed. The customer moved to History and this vehicle moved to ${result.vehicle?.status || returnDraft.vehicleStatus}.`);
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  const archive = async () => {
    if (!draft || !archiveConfirmed || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await archiveVehicle(draft.id, draft.updatedAt); await refresh(undefined, true); closeDetail(); setFilter('history'); setNotice('Vehicle archived in History. Its records were preserved and its website listing was removed.');
    } catch (requestError) { const message = (requestError as Error).message; await refresh(undefined, true); setError(message); }
    finally { setSaving(false); }
  };

  return <main className={`operations-workspace resource-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index swipe-zone" {...filterSwipe}>
      <header className="workspace-title"><div><span>Inventory, service, and history</span><h1>Fleet</h1></div><div className="workspace-head-actions">{viewed.unreadCount ? <button type="button" className="unread-summary" onClick={viewed.markAllViewed}>{viewed.unreadCount} new</button> : null}{canManage ? <button type="button" className="primary-command" onClick={openNew}><Plus size={15} /> Add car</button> : null}</div></header>
      <div className="compact-metrics four swipe-tabs" role="tablist" aria-label="Fleet status">{filters.map(key => <button type="button" role="tab" aria-selected={filter === key} key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{filterLabels[key]}</span><strong>{counts[key]}</strong></button>)}</div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search vehicle, VIN, tag, tracker, customer" /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      {!loading && visible.length ? <div className="record-table-head vehicle-table-head"><span /><span>Vehicle</span><span>Assignment</span><span>Status / mileage</span></div> : null}
      <div className="record-list vehicle-records">{loading ? <div className="empty-state">Loading fleet...</div> : null}{!loading && !visible.length ? <div className="empty-state">No vehicles match this view.</div> : null}{visible.map(vehicle => <button type="button" key={vehicle.id} className={`${vehicle.id === selectedId ? 'record-row active' : 'record-row'}${viewed.unreadIds.has(vehicle.id) ? ' unread-record' : ''}`} onClick={() => openVehicle(vehicle)} aria-label={`Open ${title(vehicle)} vehicle file`}>
        {viewed.unreadIds.has(vehicle.id) ? <span className="record-unread-dot" aria-label="Unviewed" /> : <span className={`status-line ${serviceDue(vehicle, jobs) ? 'warn' : statusTone(vehicle.status)}`} />}
        <span className="record-main"><strong>{title(vehicle)}</strong><span>{[vehicle.plate || vehicle.stock, vehicle.vin].filter(Boolean).join(' | ') || 'Identity review needed'}</span></span>
        <span className="record-context"><strong>{vehicle.currentCustomer || 'In lot'}</strong><span>{serviceDue(vehicle, jobs) ? 'Service due' : vehicle.publishedOnline ? 'Online' : vehicle.location || 'Location not set'}</span></span>
        <span className="record-side"><b>{isArchived(vehicle) ? 'History' : serviceDue(vehicle, jobs) ? 'Service due' : vehicle.currentCustomer ? 'Rented' : vehicle.publishedOnline ? 'Online' : 'In lot'}</b><time>{vehicle.mileage ? `${Number(vehicle.mileage).toLocaleString('en-US')} mi` : 'Mileage not set'}</time></span>
      </button>)}</div>
    </section>

    <section className="operations-detail">{!draft ? <div className="detail-empty"><strong>Select a vehicle</strong><span>Identity, photos, assignment, and maintenance stay in one file.</span></div> : <div className="static-detail">
      <header className="detail-header"><button type="button" className="detail-back" onClick={closeDetail}>Back</button><div><span>{creating ? 'New fleet vehicle' : isArchived(draft) ? 'Vehicle history' : 'Vehicle file'}</span><h2>{creating ? 'Add a car' : title(draft)}</h2></div>{!creating ? <em className={`status-chip ${statusTone(draft.status)}`}>{draft.status || 'Unclassified'}</em> : null}</header>
      <div className="detail-scroll">{error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
        {!creating ? <section className="identity-summary"><div><span>VIN</span><strong>{draft.vin || 'Missing'}</strong></div><div><span>Current customer</span><strong>{draft.currentCustomer || 'In lot'}</strong></div></section> : null}
        {draft.activeRentalFileId ? <div className="context-actions"><button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}>Open Rental File</button></div> : null}
        {!creating ? <nav className="vehicle-detail-tabs" aria-label="Vehicle file sections">{vehicleDetailTabs.map(tab => <button type="button" key={tab.id} className={detailTab === tab.id ? 'active' : ''} aria-current={detailTab === tab.id ? 'page' : undefined} onClick={() => setDetailTab(tab.id)}>{tab.label}{tab.id === 'service' && openJobs.length ? <b>{openJobs.length}</b> : null}</button>)}</nav> : null}
        {creating || detailTab === 'edit' ? <div className="form-grid">
          <label>Year<input disabled={!canManage || isArchived(draft)} value={draft.year || ''} onChange={event => setDraft({ ...draft, year: event.target.value })} /></label><label>Make<input required disabled={!canManage || isArchived(draft)} value={draft.make || ''} onChange={event => setDraft({ ...draft, make: event.target.value })} /></label>
          <label>Model<input required disabled={!canManage || isArchived(draft)} value={draft.model || ''} onChange={event => setDraft({ ...draft, model: event.target.value })} /></label><label>VIN<input disabled={!canManage || isArchived(draft)} value={draft.vin || ''} onChange={event => setDraft({ ...draft, vin: event.target.value.toUpperCase() })} /></label>
          <label>Permanent tag<input disabled={!canManage || isArchived(draft)} value={draft.plate || ''} onChange={event => setDraft({ ...draft, plate: event.target.value })} /></label><label>Stock / temp tag<input disabled={!canManage || isArchived(draft)} value={draft.stock || draft.tempTag || ''} onChange={event => setDraft({ ...draft, stock: event.target.value })} /></label>
          <label>Tracker<input disabled={!canManage || isArchived(draft)} value={draft.tracker || ''} onChange={event => setDraft({ ...draft, tracker: event.target.value })} /></label><label>Mileage<input disabled={!canManage || isArchived(draft)} type="number" min="0" step="1" value={draft.mileage || ''} onChange={event => setDraft({ ...draft, mileage: event.target.value })} /></label>
          <label>Color<input disabled={!canManage || isArchived(draft)} value={draft.color || ''} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label><label>Location<input disabled={!canManage || isArchived(draft)} value={draft.location || ''} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
          {creating ? <><label>Weekly payment<input type="number" min="0" step="0.01" value={pricing.weeklyPayment} onChange={event => setPricing({ ...pricing, weeklyPayment: event.target.value })} /></label><label>Down payment<input type="number" min="0" step="0.01" value={pricing.downPayment} onChange={event => setPricing({ ...pricing, downPayment: event.target.value })} /></label><div className="span-2 vehicle-create-photos"><strong>Vehicle photos</strong><label className="secondary-command"><Camera size={15} /> Choose photos<input hidden multiple type="file" accept="image/jpeg,image/png" onChange={uploadPhoto} /></label>{pendingPhotos.length ? <span>{pendingPhotos.length} selected | {pendingPhotos.map(file => file.name).join(' | ')}</span> : <small>Add as many JPG or PNG photos as needed. Each photo can be up to 5 MB.</small>}</div></> : null}
          <label className="span-2">Notes<textarea disabled={!canManage || isArchived(draft)} rows={5} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
        </div> : null}

        {!creating && detailTab === 'photos' ? <section className="transaction-history vehicle-photo-workspace"><header><div><span>Photos</span><strong>Website and staff gallery</strong></div>{canManage && !isArchived(draft) ? <label className="secondary-command compact"><Camera size={14} /> Upload photos<input hidden multiple type="file" accept="image/jpeg,image/png" onChange={uploadPhoto} /></label> : null}</header>{activePhotos.length ? <div className="vehicle-photo-grid">{activePhotos.map(photo => <figure key={photo.url}><img src={photo.url} alt={`${title(draft)} vehicle`} />{canManage && !isArchived(draft) ? <button type="button" className="danger-text-command" onClick={() => deletePhoto(photo.artifact?.id || '', photo.url)}><Trash2 size={13} /> Remove</button> : null}</figure>)}</div> : <div className="empty-state compact">No vehicle photos saved yet.</div>}</section> : null}

        {!creating && detailTab === 'service' ? <Suspense fallback={<div className="workspace-loading"><span /><strong>Opening service...</strong></div>}><FleetServicePanel vehicle={draft} jobs={selectedJobs} archived={isArchived(draft)} onRefresh={() => refresh(undefined, true)} onNotice={setNotice} onError={setError} /></Suspense> : null}

        {!creating && detailTab === 'edit' && canManage && !isArchived(draft) ? <section className="fleet-state-editor"><header><div><span>Fleet availability</span><strong>Online, in lot, prep, or service</strong></div><Globe2 size={19} /></header>{draft.currentCustomer || draft.activeRentalFileId ? <div className="inline-alert"><strong>{draft.currentCustomer || 'Active renter'} is assigned.</strong> Use the Renter tab to return or reassign it without losing customer history.</div> : <><label>Status<select value={fleetState} onChange={event => setFleetState(event.target.value as FleetState)}><option value="online">Online and available</option><option value="offline">Offline / in lot</option><option value="ready">Ready / in lot</option><option value="prep">Prep</option><option value="service">Service</option><option value="returned">Returned</option></select></label><small className="fleet-state-effect">Online publishes this car. Every other state immediately removes it from the public website.</small><button type="button" className="secondary-command" disabled={saving || String(draft.status || '').toLowerCase() === fleetState} onClick={saveFleetState}>{saving ? 'Updating...' : 'Update fleet state'}</button></>}</section> : null}

        {!creating && detailTab === 'renter' ? <section className="assignment-editor"><header><div><span>Current renter</span><strong>{draft.currentCustomer || 'No customer assigned'}</strong></div><UserRoundPlus size={19} /></header>
          {draft.currentCustomer ? <><div className="assignment-current"><CarFront size={18} /><span><strong>{draft.currentCustomer}</strong><small>{draft.activeRentalFileId ? 'Return it to the lot or reassign it here.' : 'Open the customer file to resolve this legacy assignment.'}</small></span></div><div className="context-actions">{draft.activeRentalFileId ? <button type="button" className="primary-command compact" onClick={() => setReturnOpen(value => !value)}><RotateCcw size={15} /> Return to lot</button> : null}<button type="button" className="text-command" onClick={() => onNavigate('customers')}>Open customer file</button>{draft.activeRentalFileId ? <button type="button" className="text-command" onClick={() => onOpenRental(draft.activeRentalFileId || '')}>Open Rental File</button> : null}</div></> : null}
          {returnOpen && draft.activeRentalFileId ? <form className="fleet-return-form" onSubmit={submitReturn}><div className="form-grid"><label>Return date<input type="date" value={returnDraft.endDate} onChange={event => setReturnDraft({ ...returnDraft, endDate: event.target.value })} required /></label><label>Ending mileage<input type="number" min="0" step="1" value={returnDraft.endingMileage} onChange={event => setReturnDraft({ ...returnDraft, endingMileage: event.target.value })} required /></label><label>Vehicle goes to<select value={returnDraft.vehicleStatus} onChange={event => setReturnDraft({ ...returnDraft, vehicleStatus: event.target.value as 'Ready' | 'Prep' | 'Service' })}><option>Ready</option><option>Prep</option><option>Service</option></select></label><label className="span-2">Return reason and condition<textarea rows={3} value={returnDraft.reason} onChange={event => setReturnDraft({ ...returnDraft, reason: event.target.value })} required /></label></div><label className="sensitive-confirmation"><input type="checkbox" checked={returnConfirmed} onChange={event => setReturnConfirmed(event.target.checked)} /><span><strong>I confirm the vehicle is physically back.</strong><small>This ends the rental, stops its active schedule, moves the customer to History, and returns the car to Fleet.</small></span></label><button className="danger-command" disabled={saving || !returnConfirmed}>{saving ? 'Completing return...' : 'Complete return'}</button></form> : null}
          {canManage && !isArchived(draft) ? <div className={draft.currentCustomer ? 'reassignment-controls' : ''}><div className="form-grid"><label>Exact customer<select value={assignmentCustomerId} onChange={event => { setAssignmentCustomerId(event.target.value); setAssignmentConfirmed(false); }}><option value="">Choose customer</option>{customers.filter(customer => !isHistoryCustomer(customer)).map(customer => <option key={customer.id} value={customer.id}>{[customer.name, customer.vehicle ? `Current: ${customer.vehicle}` : 'No vehicle', customer.phone || customer.email].filter(Boolean).join(' | ')}</option>)}</select></label><label>Reason<input value={assignmentReason} onChange={event => setAssignmentReason(event.target.value)} /></label></div><label className="sensitive-confirmation"><input type="checkbox" checked={assignmentConfirmed} onChange={event => setAssignmentConfirmed(event.target.checked)} /><span><strong>I confirmed the customer and exact vehicle.</strong><small>{draft.currentCustomer ? `Reassignment ends ${draft.currentCustomer}'s current vehicle contract and preserves it in History.` : 'A swap updates the connected Rental File, payments, and history.'}</small></span></label><button type="button" className="secondary-command" disabled={saving || !assignmentConfirmed || !assignmentCustomerId} onClick={assignVehicle}>{saving ? 'Saving assignment...' : draft.currentCustomer ? 'Reassign vehicle' : 'Assign vehicle'}</button></div> : !draft.currentCustomer ? <div className="empty-state compact">No renter is assigned.</div> : null}
        </section> : null}

        {!creating && detailTab === 'history' ? <><section className="service-job-section"><header><strong>Maintenance history</strong><span>{completedJobs.length}</span></header>{completedJobs.length ? <div className="service-job-list">{completedJobs.map(job => <article key={job.id}><span className="status-line good" /><div><strong>{job.issue || job.type || 'Service'}</strong><small>{`Done ${dateTime(job.fixedAt || job.completedAt)}${job.mechanicSignoff ? ` · ${job.mechanicSignoff}` : ''}`}</small></div></article>)}</div> : <div className="empty-state compact">No completed maintenance is saved yet.</div>}</section>{canManage && !isArchived(draft) ? <section className="assignment-editor"><header><div><span>Vehicle history</span><strong>Archive, never erase</strong></div><Trash2 size={19} /></header><label className="sensitive-confirmation"><input type="checkbox" checked={archiveConfirmed} onChange={event => setArchiveConfirmed(event.target.checked)} /><span><strong>Move this vehicle to History.</strong><small>The car must be unassigned. Its maintenance, assignment, and audit records remain saved.</small></span></label><button type="button" className="danger-command" disabled={saving || !archiveConfirmed} onClick={archive}>Archive vehicle</button></section> : null}</> : null}
      </div>
      <footer className="detail-actions">{canManage && !isArchived(draft) && (creating || detailTab === 'edit') ? <button type="button" className="primary-command" disabled={saving || !draft.make?.trim() || !draft.model?.trim()} onClick={saveVehicle}>{saving ? 'Saving...' : creating ? 'Add vehicle' : 'Save vehicle'}</button> : null}</footer>
    </div>}</section>
  </main>;
}
