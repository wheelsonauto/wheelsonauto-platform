import { useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Wrench } from 'lucide-react';
import { completeMaintenance, saveMaintenance } from '../api';
import type { MaintenanceRecord, VehicleRecord } from '../types';
import { dateTime, shortDate } from '../ui';

function vehicleTitle(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function closed(job: MaintenanceRecord) {
  return /complete|fixed|closed|superseded|cancelled|canceled|duplicate/i.test(job.status || '');
}

function inspection(job: MaintenanceRecord) {
  const label = [job.type, job.issue].filter(Boolean).join(' ').toLowerCase();
  return /monthly inspection|monthly oil|oil change/.test(label) || /^inspection$/.test(String(job.type || '').trim().toLowerCase());
}

function emptyService(vehicle: VehicleRecord): MaintenanceRecord {
  return { id: `mnt-${Date.now()}`, vehicleId: vehicle.id, vehicle: vehicleTitle(vehicle), type: 'Repair job', issue: '', due: todayKey(), reminder: 'Remind customer when due', notes: '', status: 'Scheduled', inspectionRecurrence: 'recurring', inspectionIntervalValue: 1, inspectionIntervalUnit: 'months' };
}

export default function FleetServicePanel({ vehicle, jobs, archived, onRefresh, onCommitted, onNotice, onError }: {
  vehicle: VehicleRecord;
  jobs: MaintenanceRecord[];
  archived: boolean;
  onRefresh: () => Promise<void>;
  onCommitted: (result: { job: MaintenanceRecord; vehicle?: VehicleRecord; nextReminder?: MaintenanceRecord }) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<MaintenanceRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const openJobs = useMemo(() => jobs.filter(job => !closed(job)), [jobs]);
  const completedJobs = useMemo(() => jobs.filter(closed), [jobs]);
  const openInspection = useMemo(() => openJobs.find(inspection) || null, [openJobs]);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true); onError(''); onNotice('');
    try {
      const result = await saveMaintenance({ ...draft, vehicleId: vehicle.id, vehicle: vehicleTitle(vehicle), expectedUpdatedAt: draft.updatedAt });
      onCommitted(result); setDraft(null); onNotice(inspection(draft) ? 'Inspection schedule saved. Only one open inspection reminder remains.' : 'Service saved to this vehicle file.');
    } catch (error) { const message = (error as Error).message; await onRefresh(); onError(message); }
    finally { setSaving(false); }
  };

  const complete = async (job: MaintenanceRecord) => {
    if (saving) return;
    setSaving(true); onError(''); onNotice('');
    try {
      const result = await completeMaintenance(job.id, {
        expectedUpdatedAt: job.updatedAt || '', cost: job.cost, completedAt: todayKey(), odometer: vehicle.mileage || job.odometer || job.mileageAtService || '',
        inspectionCondition: job.inspectionCondition || 'Good', inspectionChecklist: job.inspectionChecklist || [], damageNotes: job.damageNotes || '',
        mechanicSignoff: window.__WOA_STAFF_USER__?.name || window.__WOA_STAFF_USER__?.username || 'WheelsonAuto staff', notes: job.notes || ''
      });
      onCommitted(result);
      onNotice(result.nextReminder ? `Completed. The next inspection is ${shortDate(result.nextReminder.due)}.` : inspection(job) ? 'Inspection completed. This was a one-time schedule, so no new reminder was created.' : 'Service completed and saved in maintenance history.');
    } catch (error) { const message = (error as Error).message; await onRefresh(); onError(message); }
    finally { setSaving(false); }
  };

  const editInspection = () => setDraft(openInspection ? { ...openInspection } : {
    ...emptyService(vehicle), id: `mnt-inspection-${Date.now()}`, type: 'Monthly inspection / oil change', issue: 'Monthly inspection / oil change',
    inspectionRecurrence: vehicle.inspectionRecurrence || 'recurring', inspectionIntervalValue: vehicle.inspectionIntervalValue || 1, inspectionIntervalUnit: vehicle.inspectionIntervalUnit || 'months'
  });

  const completeInspection = async () => {
    if (openInspection) { await complete(openInspection); return; }
    setSaving(true); onError(''); onNotice('');
    try {
      const result = await completeMaintenance(`mnt-inspection-${Date.now()}`, { createIfMissing: true, vehicleId: vehicle.id, inspectionRecurrence: vehicle.inspectionRecurrence || 'recurring', inspectionIntervalValue: vehicle.inspectionIntervalValue || 1, inspectionIntervalUnit: vehicle.inspectionIntervalUnit || 'months', completedAt: todayKey(), odometer: vehicle.mileage || '', inspectionCondition: 'Good', inspectionChecklist: [], damageNotes: '', mechanicSignoff: window.__WOA_STAFF_USER__?.name || window.__WOA_STAFF_USER__?.username || 'WheelsonAuto staff', notes: 'Inspection completed from Fleet.' });
      onCommitted(result); onNotice(result.nextReminder ? `Inspection completed. The next inspection is ${shortDate(result.nextReminder.due)}.` : 'Inspection completed. No repeating reminder was requested.');
    } catch (error) { const message = (error as Error).message; await onRefresh(); onError(message); }
    finally { setSaving(false); }
  };

  return <section className="vehicle-service-workspace"><header className="service-workspace-header"><div><span>Service</span><strong>Open work and inspection schedule</strong></div>{!archived ? <div className="maintenance-quick-actions"><button type="button" className="primary-command compact" disabled={saving} onClick={completeInspection}><CheckCircle2 size={14} /> {saving ? 'Saving...' : 'Complete inspection'}</button><button type="button" className="text-command" disabled={saving} onClick={editInspection}><CalendarClock size={14} /> {openInspection ? 'Edit inspection' : 'Set inspection'}</button><button type="button" className="secondary-command compact" disabled={saving} onClick={() => setDraft(current => current && !inspection(current) ? null : emptyService(vehicle))}><Wrench size={14} /> Add service</button></div> : null}</header>
    {draft ? <section className="payment-action-sheet"><div className="form-grid compact-action-form"><label>Service type<select value={draft.type || 'Repair job'} onChange={event => { const type = event.target.value; setDraft({ ...draft, type, issue: inspection({ ...draft, type }) && !draft.issue ? 'Monthly inspection / oil change' : draft.issue }); }}><option>Repair job</option><option>Monthly inspection / oil change</option><option>Tires / brakes</option><option>Warning light</option><option>Body / damage</option><option>Other service</option></select></label><label>Due date<input type="date" value={draft.due || ''} onChange={event => setDraft({ ...draft, due: event.target.value })} /></label>{inspection(draft) ? <><label>Schedule<select value={draft.inspectionRecurrence || 'recurring'} onChange={event => setDraft({ ...draft, inspectionRecurrence: event.target.value as 'one_time' | 'recurring' })}><option value="recurring">Repeat forever</option><option value="one_time">One time only</option></select></label>{draft.inspectionRecurrence !== 'one_time' ? <label>Repeat every<div className="inspection-interval"><input type="number" min="1" max="60" step="1" value={draft.inspectionIntervalValue || 1} onChange={event => setDraft({ ...draft, inspectionIntervalValue: Number(event.target.value) })} /><select value={draft.inspectionIntervalUnit || 'months'} onChange={event => setDraft({ ...draft, inspectionIntervalUnit: event.target.value as 'days' | 'weeks' | 'months' })}><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option></select></div></label> : <div />}</> : null}<label className="span-2">Needed service<input value={draft.issue || ''} onChange={event => setDraft({ ...draft, issue: event.target.value })} /></label><label className="span-2">Mechanic / staff notes<textarea rows={3} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label></div><button type="button" className="primary-command full-command" disabled={saving || !draft.issue?.trim()} onClick={save}>{saving ? 'Saving...' : inspection(draft) ? 'Save inspection schedule' : 'Save service'}</button></section> : null}
    <section className="service-job-section"><header><strong>Open service</strong><span>{openJobs.length}</span></header>{openJobs.length ? <div className="service-job-list">{openJobs.map(job => <article key={job.id}><span className={`status-line ${(job.due || job.nextDue || '') <= todayKey() ? 'warn' : 'neutral'}`} /><div><strong>{job.issue || job.type || 'Service'}</strong><small>{`Due ${shortDate(job.due || job.nextDue)} · ${job.status || 'Scheduled'}`}{inspection(job) && job.inspectionRecurrence === 'recurring' ? ` · Every ${job.inspectionIntervalValue || 1} ${job.inspectionIntervalUnit || 'month'}` : inspection(job) ? ' · One time' : ''}{job.notes ? ` · ${job.notes}` : ''}</small></div><div className="service-row-actions">{inspection(job) ? <button type="button" className="text-command" disabled={saving} onClick={() => setDraft({ ...job })}>Edit</button> : null}<button type="button" className="secondary-command compact inspection-complete-command" disabled={saving} onClick={() => complete(job)}><CheckCircle2 size={13} /> {saving ? 'Saving...' : inspection(job) ? 'Complete inspection' : 'Complete service'}</button></div></article>)}</div> : <div className="empty-state compact">No open service is waiting.</div>}</section>
    <section className="service-job-section completed"><header><strong>Service history</strong><span>{completedJobs.length}</span></header>{completedJobs.length ? <div className="service-job-list">{completedJobs.map(job => <article key={job.id}><span className="status-line good" /><div><strong>{job.issue || job.type || 'Service'}</strong><small>{`Done ${dateTime(job.fixedAt || job.completedAt)}${job.mechanicSignoff ? ` · ${job.mechanicSignoff}` : ''}`}{job.notes ? ` · ${job.notes}` : ''}</small></div></article>)}</div> : <div className="empty-state compact">Completed service will appear here.</div>}</section>
  </section>;
}
