import { FormEvent, useEffect, useMemo, useState } from 'react';
import { completeMaintenance, loadMaintenance, loadVehicles, saveMaintenance } from '../api';
import type { MaintenanceRecord, VehicleRecord } from '../types';
import { useSwipeTabs } from '../useSwipeTabs';

type Filter = 'open' | 'due' | 'history';
const filters: readonly Filter[] = ['open', 'due', 'history'];

const checklistOptions = [
  ['oil', 'Oil / filter'], ['tires', 'Tires'], ['brakes', 'Brakes'], ['lights', 'Lights'],
  ['fluids', 'Fluids'], ['warningLights', 'Warning lights'], ['damage', 'Body / damage'], ['tracker', 'Tracker']
] as const;

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextMonthKey() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function vehicleName(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

function isClosed(job: MaintenanceRecord) {
  return /complete|fixed|closed/i.test(job.status || '');
}

function jobTone(job: MaintenanceRecord) {
  if (isClosed(job)) return 'good';
  const due = job.due || job.nextDue || '';
  if (due && due < todayKey()) return 'bad';
  if (due === todayKey()) return 'warn';
  return 'neutral';
}

function emptyJob(): MaintenanceRecord {
  return { id: `mnt-${Date.now()}`, vehicleId: '', type: 'Monthly inspection / oil change', issue: '', cost: 0, due: nextMonthKey(), reminder: 'Remind customer when due', notes: '', status: 'Scheduled' };
}

export function MaintenancePage() {
  const [jobs, setJobs] = useState<MaintenanceRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<MaintenanceRecord | null>(null);
  const [completing, setCompleting] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mechanic = String(window.__WOA_STAFF_USER__?.role || '').toLowerCase() === 'mechanic';

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [maintenanceFeed, vehicleFeed] = await Promise.all([loadMaintenance(signal, force), loadVehicles(signal, force)]);
      setJobs(maintenanceFeed.records || []);
      setVehicles(vehicleFeed.records || []);
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    const onPlatform = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).some((topic: string) => topic === 'service' || topic === 'assignments')) void refresh(undefined, true);
      } catch { /* The next valid event will refresh this feed. */ }
    };
    events.addEventListener('platform', onPlatform as EventListener);
    return () => { controller.abort(); events.close(); };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const current = jobs.find(job => job.id === selectedId);
    if (current) setDraft({ ...current, inspectionChecklist: [...(current.inspectionChecklist || [])] });
  }, [selectedId, jobs]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return jobs.filter(job => {
      const closed = isClosed(job);
      const due = job.due || job.nextDue || '';
      if (filter === 'open' && closed) return false;
      if (filter === 'history' && !closed) return false;
      if (filter === 'due' && (closed || !due || due > todayKey())) return false;
      const text = [job.vehicle, job.customer, job.vin, job.plate, job.tracker, job.type, job.issue, job.status, job.mechanicSignoff].join(' ').toLowerCase();
      return words.every(word => text.includes(word));
    });
  }, [jobs, query, filter]);

  const counts = useMemo(() => ({
    open: jobs.filter(job => !isClosed(job)).length,
    due: jobs.filter(job => !isClosed(job) && !!(job.due || job.nextDue) && (job.due || job.nextDue || '') <= todayKey()).length,
    history: jobs.filter(isClosed).length
  }), [jobs]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !draft.vehicleId || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await saveMaintenance({ ...draft, expectedUpdatedAt: draft.updatedAt });
      await refresh(undefined, true);
      setSelectedId(result.job.id);
      setDraft(result.job);
      setNotice('Maintenance job saved');
    } catch (requestError) {
      setError((requestError as Error).message);
      await refresh(undefined, true);
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (!draft || !draft.updatedAt || !draft.mechanicSignoff?.trim() || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await completeMaintenance(draft.id, {
        expectedUpdatedAt: draft.updatedAt,
        cost: draft.cost,
        completedAt: draft.completedAt || todayKey(),
        odometer: draft.odometer || draft.mileageAtService || '',
        inspectionCondition: draft.inspectionCondition || 'Good',
        inspectionChecklist: draft.inspectionChecklist || [],
        damageNotes: draft.damageNotes || '',
        mechanicSignoff: draft.mechanicSignoff,
        notes: draft.notes || ''
      });
      await refresh(undefined, true);
      setSelectedId(result.job.id);
      setDraft(result.job);
      setCompleting(false);
      setNotice(result.nextReminder ? `Completed. Next monthly visit: ${result.nextReminder.due}` : 'Maintenance completed');
    } catch (requestError) {
      setError((requestError as Error).message);
      await refresh(undefined, true);
    } finally {
      setSaving(false);
    }
  };

  const openNew = () => {
    setSelectedId(''); setDraft(emptyJob()); setCompleting(false); setError(''); setNotice('');
  };

  const toggleChecklist = (key: string) => {
    if (!draft) return;
    const values = new Set(draft.inspectionChecklist || []);
    if (values.has(key)) values.delete(key); else values.add(key);
    setDraft({ ...draft, inspectionChecklist: [...values] });
  };

  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  return <main className={`operations-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index swipe-zone" {...filterSwipe}>
      <header className="workspace-title"><div><span>Fleet care</span><h1>Maintenance</h1></div><button type="button" className="primary-command" onClick={openNew}>Schedule</button></header>
      <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Maintenance status">
        <button type="button" role="tab" aria-selected={filter === 'open'} className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}><span>Open</span><strong>{counts.open}</strong></button>
        <button type="button" role="tab" aria-selected={filter === 'due'} className={filter === 'due' ? 'active' : ''} onClick={() => setFilter('due')}><span>Due now</span><strong>{counts.due}</strong></button>
        <button type="button" role="tab" aria-selected={filter === 'history'} className={filter === 'history' ? 'active' : ''} onClick={() => setFilter('history')}><span>History</span><strong>{counts.history}</strong></button>
      </div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search vehicle, VIN, tag, customer" /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      <div className="record-list">
        {loading ? <div className="empty-state">Loading maintenance...</div> : null}
        {!loading && !visible.length ? <div className="empty-state">No service records match this view.</div> : null}
        {visible.map(job => <button type="button" key={job.id} className={job.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => { setSelectedId(job.id); setCompleting(false); }} aria-label={`Open ${job.vehicle || 'vehicle'} service record`}>
          <span className={`status-line ${jobTone(job)}`} aria-hidden="true" />
          <span className="record-main"><strong>{job.vehicle || 'Vehicle'}</strong><span>{[job.customer, job.issue || job.type].filter(Boolean).join(' | ')}</span></span>
          <span className="record-side"><b>{job.status || 'Scheduled'}</b><time>{job.due || job.nextDue || 'No due date'}</time></span>
        </button>)}
      </div>
    </section>

    <section className="operations-detail">
      {!draft ? <div className="detail-empty"><strong>Select a service record</strong><span>Open a job or schedule maintenance.</span></div> : <form onSubmit={submit}>
        <header className="detail-header"><button type="button" className="detail-back" onClick={() => { setDraft(null); setSelectedId(''); setCompleting(false); }} aria-label="Back to maintenance">Back</button><div><span>{completing ? 'Completion review' : 'Service record'}</span><h2>{draft.vehicle || 'New maintenance job'}</h2></div>{draft.status ? <small>{draft.status}</small> : null}</header>
        <div className="detail-scroll">
          {error ? <div className="inline-alert error">{error}</div> : null}
          {notice ? <div className="inline-alert">{notice}</div> : null}
          {!completing ? <div className="form-grid">
            <label className="span-2">Vehicle<select required value={draft.vehicleId || ''} onChange={event => setDraft({ ...draft, vehicleId: event.target.value })}><option value="">Choose exact vehicle</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicleName(vehicle)} | {vehicle.vin || vehicle.plate || vehicle.stock || vehicle.id}</option>)}</select></label>
            <label>Type<select value={draft.type || 'Repair job'} onChange={event => setDraft({ ...draft, type: event.target.value })}><option>Monthly inspection / oil change</option><option>Repair job</option><option>Future repair note</option></select></label>
            <label>Status<select value={draft.status || 'Scheduled'} onChange={event => setDraft({ ...draft, status: event.target.value })}><option>Scheduled</option><option>Customer requested</option><option>In progress</option><option>Waiting for part</option><option>Completed</option></select></label>
            <label className="span-2">Issue / service<input value={draft.issue || ''} onChange={event => setDraft({ ...draft, issue: event.target.value })} /></label>
            {!mechanic ? <label>Cost<input type="number" min="0" step="0.01" value={draft.cost || 0} onChange={event => setDraft({ ...draft, cost: Number(event.target.value) })} /></label> : null}
            <label>Due date<input type="date" value={draft.due || draft.nextDue || ''} onChange={event => setDraft({ ...draft, due: event.target.value })} /></label>
            <label className="span-2">Reminder<select value={draft.reminder || 'Remind customer when due'} onChange={event => setDraft({ ...draft, reminder: event.target.value })}><option>Remind customer when due</option><option>Internal only</option></select></label>
            <label className="span-2">Notes<textarea rows={7} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
          </div> : <div className="form-grid">
            {!mechanic ? <label>Final cost<input type="number" min="0" step="0.01" value={draft.cost || 0} onChange={event => setDraft({ ...draft, cost: Number(event.target.value) })} /></label> : null}
            <label>Completed date<input type="date" value={draft.completedAt || todayKey()} onChange={event => setDraft({ ...draft, completedAt: event.target.value })} /></label>
            <label>Mileage<input type="number" min="0" step="1" value={draft.odometer || draft.mileageAtService || ''} onChange={event => setDraft({ ...draft, odometer: event.target.value })} /></label>
            <label>Condition<select value={draft.inspectionCondition || 'Good'} onChange={event => setDraft({ ...draft, inspectionCondition: event.target.value })}><option>Good</option><option>Needs attention</option><option>Unsafe / hold</option></select></label>
            <fieldset className="span-2 checklist"><legend>Inspection checklist</legend>{checklistOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={(draft.inspectionChecklist || []).includes(key)} onChange={() => toggleChecklist(key)} /><span>{label}</span></label>)}</fieldset>
            <label className="span-2">Damage / condition notes<textarea rows={4} value={draft.damageNotes || ''} onChange={event => setDraft({ ...draft, damageNotes: event.target.value })} /></label>
            <label className="span-2">Mechanic sign-off<input required value={draft.mechanicSignoff || window.__WOA_STAFF_USER__?.name || ''} onChange={event => setDraft({ ...draft, mechanicSignoff: event.target.value })} /></label>
            <label className="span-2">Completion notes<textarea rows={5} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
          </div>}
        </div>
        <footer className="detail-actions">
          {!completing ? <button className="primary-command" disabled={saving || !draft.vehicleId}>{saving ? 'Saving...' : 'Save job'}</button> : <button type="button" className="primary-command" onClick={finish} disabled={saving || !draft.mechanicSignoff?.trim()}>{saving ? 'Completing...' : 'Complete job'}</button>}
          {draft.updatedAt && !isClosed(draft) ? <button type="button" className="secondary-command" onClick={() => setCompleting(value => !value)}>{completing ? 'Back to job' : 'Complete'}</button> : null}
        </footer>
      </form>}
    </section>
  </main>;
}
