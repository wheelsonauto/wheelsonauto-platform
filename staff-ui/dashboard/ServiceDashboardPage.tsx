import { useEffect, useMemo, useState } from 'react';
import { loadMaintenance, loadNotifications, loadTasks, loadVehicles } from '../api';
import type { MaintenanceRecord, NotificationRecord, TaskRecord, VehicleRecord } from '../types';
import { dateTime, statusTone } from '../ui';

type ServiceState = {
  vehicles: VehicleRecord[];
  maintenance: MaintenanceRecord[];
  tasks: TaskRecord[];
  notifications: NotificationRecord[];
};

const emptyState: ServiceState = { vehicles: [], maintenance: [], tasks: [], notifications: [] };

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isOpen(status = '') {
  return !/done|closed|complete|fixed|cancelled/i.test(status);
}

export function ServiceDashboardPage({ onNavigate }: { onNavigate: (workspace: string) => void }) {
  const [state, setState] = useState<ServiceState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [vehicles, maintenance, tasks, notifications] = await Promise.all([
        loadVehicles(signal, force), loadMaintenance(signal, force), loadTasks(signal, force), loadNotifications(signal, force)
      ]);
      setState({
        vehicles: vehicles.records || [],
        maintenance: maintenance.records || [],
        tasks: tasks.records || [],
        notifications: notifications.notifications || notifications.notices || notifications.items || []
      });
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', () => void refresh(undefined, true));
    return () => { controller.abort(); events.close(); };
  }, []);

  const today = todayKey();
  const openJobs = useMemo(() => state.maintenance.filter(job => isOpen(job.status)), [state.maintenance]);
  const dueJobs = openJobs.filter(job => !!(job.due || job.nextDue) && String(job.due || job.nextDue) <= today);
  const serviceVehicles = state.vehicles.filter(vehicle => /service|repair|maintenance/i.test(vehicle.status || ''));
  const openTasks = state.tasks.filter(task => isOpen(task.status));
  const priorities = [
    ...dueJobs.map(job => ({ id: `job-${job.id}`, title: job.vehicle || 'Vehicle service', detail: [job.issue || job.type || 'Service due', job.vin || job.plate || '', job.customer || 'In lot'].filter(Boolean).join(' | '), status: job.status || 'Due', target: 'maintenance' })),
    ...openTasks.filter(task => !task.due || task.due <= today).map(task => ({ id: `task-${task.id}`, title: task.title || 'Shop task', detail: [task.vehicle, task.customer, task.due ? `Due ${task.due}` : 'No due date'].filter(Boolean).join(' | '), status: task.status || 'Open', target: 'dispatch' }))
  ].slice(0, 12);

  return <main className="dashboard-workspace service-dashboard">
    <header className="page-heading"><div><span>Mechanic workspace</span><h1>Service home</h1><p>Today&apos;s jobs, vehicles, inspections, and sign-off work. Customer money and private account tools stay out of this workspace.</p></div><time>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</time></header>
    {error ? <div className="inline-alert error">{error}</div> : null}
    <section className="metric-strip" aria-label="Service summary">
      <button onClick={() => onNavigate('maintenance')}><span>Open jobs</span><strong>{loading ? '...' : openJobs.length}</strong><small>active service records</small></button>
      <button onClick={() => onNavigate('maintenance')}><span>Due now</span><strong>{loading ? '...' : dueJobs.length}</strong><small>due or overdue</small></button>
      <button onClick={() => onNavigate('fleet')}><span>In service</span><strong>{loading ? '...' : serviceVehicles.length}</strong><small>vehicles unavailable</small></button>
      <button onClick={() => onNavigate('dispatch')}><span>Shop tasks</span><strong>{loading ? '...' : openTasks.length}</strong><small>open assignments</small></button>
    </section>
    <div className="dashboard-grid">
      <section className="dashboard-panel priority-panel"><header><div><span>Today</span><h2>Work queue</h2></div><button className="text-command" onClick={() => onNavigate('maintenance')}>Open maintenance</button></header>
        <div className="priority-list">{loading ? <div className="empty-state">Loading shop work...</div> : priorities.length ? priorities.map(item => <button key={item.id} onClick={() => onNavigate(item.target)}><span className={`status-line ${statusTone(item.status)}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.status}</b></button>) : <div className="empty-state compact">No urgent shop work is waiting.</div>}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Fleet pulse</span><h2>Vehicle status</h2></div><button className="text-command" onClick={() => onNavigate('fleet')}>Open vehicles</button></header>
        <div className="distribution-list">{['Service', 'Prep', 'Ready', 'Assigned'].map(label => { const count = state.vehicles.filter(vehicle => new RegExp(label, 'i').test(vehicle.status || '')).length; const percent = state.vehicles.length ? Math.max(3, count / state.vehicles.length * 100) : 0; return <div key={label}><span><b>{label}</b><em>{count}</em></span><i><u style={{ width: `${percent}%` }} /></i></div>; })}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Shop activity</span><h2>Latest updates</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Open queue</button></header>
        <div className="activity-list">{state.notifications.slice(0, 7).map(notice => <article key={notice.id}><span className={`activity-mark ${statusTone(notice.tone || notice.type)}`} /><div><strong>{notice.title || notice.type || 'Shop update'}</strong><p>{notice.body || notice.message || 'New service activity is available.'}</p><time>{dateTime(notice.createdAt || notice.date)}</time></div></article>)}{!state.notifications.length && !loading ? <div className="empty-state compact">No new shop notifications.</div> : null}</div>
      </section>
    </div>
  </main>;
}
