import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Camera, CarFront, Globe2, Plus, RotateCcw, Trash2, UserRoundPlus, Wrench } from 'lucide-react';
import {
  archiveVehicle,
  assignCustomerVehicle,
  completeMaintenance,
  createVehicle,
  loadCustomers,
  loadMaintenance,
  loadVehicles,
  removeVehiclePhoto,
  saveMaintenance,
  updateVehicle,
  updateVehicleState,
  uploadVehiclePhoto
} from '../api';
import type { CustomerRecord, MaintenanceRecord, VehicleRecord } from '../types';
import { dateTime, shortDate, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { useViewedRecords } from '../useViewedRecords';

function title(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextMonthKey() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isClosed(job: MaintenanceRecord) {
  return /complete|fixed|closed/i.test(job.status || '');
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
    !!(job.due || job.nextDue) && String(job.due || job.nextDue) <= todayKey()
    || /customer requested|in progress|waiting for part|unsafe|needs attention/i.test([job.status, job.inspectionCondition].join(' '))
  ));
}

function emptyVehicle(): VehicleRecord {
  return { id: '', year: '', make: '', model: '', vin: '', plate: '', stock: '', tracker: '', color: '', mileage: '', location: 'WheelsonAuto lot', notes: '', status: 'Ready' };
}

function emptyService(vehicle: VehicleRecord): MaintenanceRecord {
  return { id: `mnt-${Date.now()}`, vehicleId: vehicle.id, vehicle: title(vehicle), type: 'Repair job', issue: '', due: todayKey(), reminder: 'Remind customer when due', notes: '', status: 'Scheduled' };
}

async function photoPayload(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('The photo could not be read.')); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, size: file.size, dataUrl };
}

type Filter = 'fleet' | 'lot' | 'service' | 'history';
type FleetState = 'online' | 'offline' | 'ready' | 'prep' | 'service' | 'returned';
const filters: readonly Filter[] = ['fleet', 'lot', 'service', 'history'];
const filterLabels: Record<Filter, string> = { fleet: 'Fleet', lot: 'In lot', service: 'Service due', history: 'History' };

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
  const [stateConfirmed, setStateConfirmed] = useState(false);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [assignmentCustomerId, setAssignmentCustomerId] = useState('');
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const [assignmentReason, setAssignmentReason] = useState('Vehicle assigned from Fleet by staff.');
  const [serviceDraft, setServiceDraft] = useState<MaintenanceRecord | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);

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
  const activePhotos = useMemo(() => draft ? Array.from(new Set(draft.imageUrls || [])).map(url => ({ url, artifact: (draft.photoArtifacts || []).find(photo => photo.url === url && !photo.removedAt) })) : [], [draft]);
  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  const closeDetail = () => {
    setDraft(null); setSelectedId(''); setCreating(false); setServiceDraft(null); setPendingPhotos([]); setError(''); setNotice(''); setArchiveConfirmed(false);
  };

  const openVehicle = (vehicle: VehicleRecord) => {
    viewed.markViewed(vehicle.id);
    setSelectedId(vehicle.id); setDraft({ ...vehicle }); setCreating(false); setStateConfirmed(false); setArchiveConfirmed(false);
    setAssignmentConfirmed(false); setAssignmentCustomerId(''); setServiceDraft(null); setError(''); setNotice('');
  };

  const openNew = () => {
    setSelectedId(''); setDraft(emptyVehicle()); setCreating(true); setPricing({ weeklyPayment: '', downPayment: '' }); setServiceDraft(null); setPendingPhotos([]); setError(''); setNotice('');
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
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
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

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!draft || !files.length || saving) return;
    if (files.some(file => !/^image\/(jpeg|png)$/i.test(file.type) || file.size > 5 * 1024 * 1024)) { setError('Every photo must be a JPG or PNG no larger than 5 MB.'); return; }
    if (creating) {
      const next = [...pendingPhotos, ...files].slice(0, 12);
      setPendingPhotos(next); setError(''); setNotice(`${next.length} photo${next.length === 1 ? '' : 's'} ready to upload with this car.`); return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      let savedRecord = draft;
      for (const file of files.slice(0, 12)) {
        const result = await uploadVehiclePhoto(savedRecord.id, { expectedUpdatedAt: savedRecord.updatedAt, file: await photoPayload(file) });
        savedRecord = result.record;
      }
      await refresh(undefined, true); setDraft(savedRecord); setNotice(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded to this vehicle and its website gallery.`);
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const deletePhoto = async (photoId: string, photoUrl: string) => {
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await removeVehiclePhoto(draft.id, photoId, photoUrl, draft.updatedAt);
      await refresh(undefined, true); setDraft(result.record); setNotice('Photo removed from the vehicle and website gallery.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const scheduleService = async () => {
    if (!draft || !serviceDraft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await saveMaintenance({ ...serviceDraft, vehicleId: draft.id, vehicle: title(draft), expectedUpdatedAt: serviceDraft.updatedAt });
      await refresh(undefined, true); setServiceDraft(null); setNotice('Service saved to this vehicle file.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const markDone = async (job: MaintenanceRecord) => {
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await completeMaintenance(job.id, {
        expectedUpdatedAt: job.updatedAt || '', cost: job.cost, completedAt: todayKey(), odometer: draft.mileage || job.odometer || job.mileageAtService || '',
        inspectionCondition: job.inspectionCondition || 'Good', inspectionChecklist: job.inspectionChecklist || [], damageNotes: job.damageNotes || '',
        mechanicSignoff: window.__WOA_STAFF_USER__?.name || window.__WOA_STAFF_USER__?.username || 'WheelsonAuto staff', notes: job.notes || ''
      });
      await refresh(undefined, true); setNotice(result.nextReminder ? `Done. The next monthly inspection is ${shortDate(result.nextReminder.due)}.` : 'Service marked done and saved in maintenance history.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const completeMonthlyInspection = async () => {
    if (!draft || saving) return;
    const openMonthly = selectedJobs.find(job => !isClosed(job) && /monthly|inspection|oil change/i.test([job.type, job.issue].join(' ')));
    if (openMonthly) { await markDone(openMonthly); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const created = await saveMaintenance({ ...emptyService(draft), id: `mnt-inspection-${Date.now()}`, type: 'Monthly inspection / oil change', issue: 'Monthly inspection / oil change', due: todayKey(), vehicleId: draft.id });
      const result = await completeMaintenance(created.job.id, { expectedUpdatedAt: created.job.updatedAt || '', completedAt: todayKey(), odometer: draft.mileage || '', inspectionCondition: 'Good', inspectionChecklist: [], damageNotes: '', mechanicSignoff: window.__WOA_STAFF_USER__?.name || window.__WOA_STAFF_USER__?.username || 'WheelsonAuto staff', notes: 'Monthly inspection completed from Fleet.' });
      await refresh(undefined, true); setNotice(`Inspection saved. The next monthly inspection is ${shortDate(result.nextReminder?.due || nextMonthKey())}.`);
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const archive = async () => {
    if (!draft || !archiveConfirmed || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await archiveVehicle(draft.id, draft.updatedAt); await refresh(undefined, true); closeDetail(); setFilter('history'); setNotice('Vehicle archived in History. Its records were preserved and its website listing was removed.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
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
        <span className="record-side"><b>{isArchived(vehicle) ? 'History' : serviceDue(vehicle, jobs) ? 'Service due' : vehicle.currentCustomer ? 'Rented' : vehicle.publishedOnline ? 'Online' : 'In lot'}</b><time>{vehicle.mileage ? `${Number(vehicle.mileage).toLocaleString()} mi` : 'Mileage not set'}</time></span>
      </button>)}</div>
    </section>

    <section className="operations-detail">{!draft ? <div className="detail-empty"><strong>Select a vehicle</strong><span>Identity, photos, assignment, and maintenance stay in one file.</span></div> : <div className="static-detail">
      <header className="detail-header"><button type="button" className="detail-back" onClick={closeDetail}>Back</button><div><span>{creating ? 'New fleet vehicle' : isArchived(draft) ? 'Vehicle history' : 'Vehicle file'}</span><h2>{creating ? 'Add a car' : title(draft)}</h2></div>{!creating ? <em className={`status-chip ${statusTone(draft.status)}`}>{draft.status || 'Unclassified'}</em> : null}</header>
      <div className="detail-scroll">{error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
        {!creating ? <section className="identity-summary"><div><span>VIN</span><strong>{draft.vin || 'Missing'}</strong></div><div><span>Current customer</span><strong>{draft.currentCustomer || 'In lot'}</strong></div></section> : null}
        {draft.activeRentalFileId ? <div className="context-actions"><button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}>Open Rental File</button></div> : null}
        <div className="form-grid">
          <label>Year<input disabled={!canManage || isArchived(draft)} value={draft.year || ''} onChange={event => setDraft({ ...draft, year: event.target.value })} /></label><label>Make<input required disabled={!canManage || isArchived(draft)} value={draft.make || ''} onChange={event => setDraft({ ...draft, make: event.target.value })} /></label>
          <label>Model<input required disabled={!canManage || isArchived(draft)} value={draft.model || ''} onChange={event => setDraft({ ...draft, model: event.target.value })} /></label><label>VIN<input disabled={!canManage || isArchived(draft)} value={draft.vin || ''} onChange={event => setDraft({ ...draft, vin: event.target.value.toUpperCase() })} /></label>
          <label>Permanent tag<input disabled={!canManage || isArchived(draft)} value={draft.plate || ''} onChange={event => setDraft({ ...draft, plate: event.target.value })} /></label><label>Stock / temp tag<input disabled={!canManage || isArchived(draft)} value={draft.stock || draft.tempTag || ''} onChange={event => setDraft({ ...draft, stock: event.target.value })} /></label>
          <label>Tracker<input disabled={!canManage || isArchived(draft)} value={draft.tracker || ''} onChange={event => setDraft({ ...draft, tracker: event.target.value })} /></label><label>Mileage<input disabled={!canManage || isArchived(draft)} type="number" min="0" step="1" value={draft.mileage || ''} onChange={event => setDraft({ ...draft, mileage: event.target.value })} /></label>
          <label>Color<input disabled={!canManage || isArchived(draft)} value={draft.color || ''} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label><label>Location<input disabled={!canManage || isArchived(draft)} value={draft.location || ''} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
          {creating ? <><label>Weekly payment<input type="number" min="0" step="0.01" value={pricing.weeklyPayment} onChange={event => setPricing({ ...pricing, weeklyPayment: event.target.value })} /></label><label>Down payment<input type="number" min="0" step="0.01" value={pricing.downPayment} onChange={event => setPricing({ ...pricing, downPayment: event.target.value })} /></label><div className="span-2 vehicle-create-photos"><strong>Vehicle photos</strong><label className="secondary-command"><Camera size={15} /> Choose photos<input hidden multiple type="file" accept="image/jpeg,image/png" onChange={uploadPhoto} /></label>{pendingPhotos.length ? <span>{pendingPhotos.map(file => file.name).join(' | ')}</span> : <small>Add up to 12 JPG or PNG photos now. You can edit the gallery later.</small>}</div></> : null}
          <label className="span-2">Notes<textarea disabled={!canManage || isArchived(draft)} rows={5} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
        </div>

        {!creating ? <><section className="transaction-history"><header><div><span>Vehicle photos</span><strong>Website and staff gallery</strong></div>{canManage && !isArchived(draft) ? <label className="secondary-command compact"><Camera size={14} /> Upload<input hidden type="file" accept="image/jpeg,image/png" onChange={uploadPhoto} /></label> : null}</header>{activePhotos.length ? <div className="payment-schedule-summary">{activePhotos.map(photo => <div key={photo.url}><img src={photo.url} alt={`${title(draft)} vehicle`} style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 5 }} />{canManage && !isArchived(draft) ? <button type="button" className="danger-text-command" onClick={() => deletePhoto(photo.artifact?.id || '', photo.url)}><Trash2 size={13} /> Remove</button> : null}</div>)}</div> : <div className="empty-state compact">No vehicle photos saved yet.</div>}</section>

          <section className="transaction-history"><header><div><span>Maintenance</span><strong>Due work and completed history</strong></div>{!isArchived(draft) ? <div className="maintenance-quick-actions"><button type="button" className="text-command" disabled={saving} onClick={completeMonthlyInspection}>Monthly inspection done</button><button type="button" className="secondary-command compact" onClick={() => setServiceDraft(current => current ? null : emptyService(draft))}><Wrench size={14} /> Add service</button></div> : null}</header>
            {serviceDraft ? <section className="payment-action-sheet"><div className="form-grid compact-action-form"><label>Due date<input type="date" value={serviceDraft.due || ''} onChange={event => setServiceDraft({ ...serviceDraft, due: event.target.value })} /></label><label>Needed service<input value={serviceDraft.issue || ''} onChange={event => setServiceDraft({ ...serviceDraft, issue: event.target.value })} /></label><label className="span-2">Mechanic / staff notes<textarea rows={3} value={serviceDraft.notes || ''} onChange={event => setServiceDraft({ ...serviceDraft, notes: event.target.value })} /></label></div><button type="button" className="primary-command full-command" disabled={saving || !serviceDraft.issue?.trim()} onClick={scheduleService}>{saving ? 'Saving...' : 'Save needed service'}</button></section> : null}
            {selectedJobs.length ? selectedJobs.map(job => <article key={job.id}><span className={`status-line ${isClosed(job) ? 'good' : (job.due || job.nextDue || '') <= todayKey() ? 'warn' : 'neutral'}`} /><div><strong>{job.issue || job.type || 'Service'}</strong><small>{isClosed(job) ? `Done ${dateTime(job.fixedAt || job.completedAt)}${job.mechanicSignoff ? ` | ${job.mechanicSignoff}` : ''}` : `Due ${shortDate(job.due || job.nextDue)} | ${job.status || 'Scheduled'}`}{job.notes ? ` | ${job.notes}` : ''}</small></div>{!isClosed(job) ? <button type="button" className="text-command" disabled={saving} onClick={() => markDone(job)}>Done</button> : null}</article>) : <div className="empty-state compact">No maintenance history is connected to this car yet.</div>}
          </section>

          {canManage && !isArchived(draft) ? <><section className="fleet-state-editor"><header><div><span>Fleet availability</span><strong>Online, in lot, prep, or service</strong></div><Globe2 size={19} /></header>{draft.currentCustomer || draft.activeRentalFileId ? <div className="inline-alert"><strong>{draft.currentCustomer || 'Active renter'} is assigned.</strong> Complete the Rental File return before changing availability.</div> : <><label>Status<select value={fleetState} onChange={event => { setFleetState(event.target.value as FleetState); setStateConfirmed(false); }}><option value="online">Online and available</option><option value="offline">Offline / in lot</option><option value="ready">Ready / in lot</option><option value="prep">Prep</option><option value="service">Service</option><option value="returned">Returned</option></select></label><label className="sensitive-confirmation"><input type="checkbox" checked={stateConfirmed} onChange={event => setStateConfirmed(event.target.checked)} /><span><strong>I confirmed this exact vehicle and state.</strong><small>Online publishes its linked listing. Every other state removes it from public inventory.</small></span></label><button type="button" className="secondary-command" disabled={saving || !stateConfirmed} onClick={saveFleetState}>{saving ? 'Updating...' : 'Update fleet state'}</button></>}</section>

          <section className="assignment-editor"><header><div><span>Customer assignment</span><strong>{draft.currentCustomer ? 'Current renter' : 'Assign or swap'}</strong></div><UserRoundPlus size={19} /></header>{draft.currentCustomer ? <><div className="assignment-current"><CarFront size={18} /><span><strong>{draft.currentCustomer}</strong><small>Use the Rental File to complete a return before reassignment.</small></span></div><div className="context-actions">{draft.activeRentalFileId ? <button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}><RotateCcw size={15} /> Complete return</button> : null}<button type="button" className="text-command" onClick={() => onNavigate('customers')}>Open customer files</button></div></> : <><label>Exact customer<select value={assignmentCustomerId} onChange={event => { setAssignmentCustomerId(event.target.value); setAssignmentConfirmed(false); }}><option value="">Choose customer</option>{customers.filter(customer => !isHistoryCustomer(customer)).map(customer => <option key={customer.id} value={customer.id}>{[customer.name, customer.vehicle ? `Current: ${customer.vehicle}` : 'No vehicle', customer.phone || customer.email].filter(Boolean).join(' | ')}</option>)}</select></label><label>Reason<input value={assignmentReason} onChange={event => setAssignmentReason(event.target.value)} /></label><label className="sensitive-confirmation"><input type="checkbox" checked={assignmentConfirmed} onChange={event => setAssignmentConfirmed(event.target.checked)} /><span><strong>I confirmed the customer and exact vehicle.</strong><small>A swap updates the connected Rental File, payments, and history.</small></span></label><button type="button" className="secondary-command" disabled={saving || !assignmentConfirmed || !assignmentCustomerId} onClick={assignVehicle}>{saving ? 'Assigning...' : 'Assign vehicle'}</button></>}</section>

          <section className="assignment-editor"><header><div><span>Vehicle history</span><strong>Archive, never erase</strong></div><Trash2 size={19} /></header><label className="sensitive-confirmation"><input type="checkbox" checked={archiveConfirmed} onChange={event => setArchiveConfirmed(event.target.checked)} /><span><strong>Move this vehicle to History.</strong><small>The car must be unassigned. Its maintenance, assignment, and audit records remain saved.</small></span></label><button type="button" className="danger-command" disabled={saving || !archiveConfirmed} onClick={archive}>Archive vehicle</button></section></> : null}</> : null}
      </div>
      <footer className="detail-actions">{canManage && !isArchived(draft) ? <button type="button" className="primary-command" disabled={saving || !draft.make?.trim() || !draft.model?.trim()} onClick={saveVehicle}>{saving ? 'Saving...' : creating ? 'Add vehicle' : 'Save vehicle'}</button> : null}</footer>
    </div>}</section>
  </main>;
}
