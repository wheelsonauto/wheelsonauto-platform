import { useEffect, useMemo, useState } from 'react';
import { loadApplications, loadCustomers, loadMaintenance, loadNotifications, loadTasks, loadVehicles } from '../api';
import type { ApplicationItem, CustomerRecord, MaintenanceRecord, NotificationRecord, TaskRecord, VehicleRecord } from '../types';
import { dateTime, statusTone } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { ApplicationsPage } from '../applications/ApplicationsPage';

type ManagerState = {
  customers: CustomerRecord[];
  vehicles: VehicleRecord[];
  applications: ApplicationItem[];
  tasks: TaskRecord[];
  maintenance: MaintenanceRecord[];
  notifications: NotificationRecord[];
};

const emptyState: ManagerState = { customers: [], vehicles: [], applications: [], tasks: [], maintenance: [], notifications: [] };

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isOpen(status = '') {
  return !/done|closed|complete|fixed|cancelled|denied|removed/i.test(status);
}

type ManagerDashboardSection = 'overview' | 'applications';
const managerDashboardSections: readonly ManagerDashboardSection[] = ['overview', 'applications'];

export function ManagerDashboardPage({ onNavigate, onOpenRental, section, onSectionChange }: { onNavigate: (workspace: string, recordId?: string) => void; onOpenRental: (rentalId: string) => void; section: ManagerDashboardSection; onSectionChange: (section: ManagerDashboardSection) => void }) {
  const [state, setState] = useState<ManagerState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [customers, vehicles, applications, tasks, maintenance, notifications] = await Promise.all([
        loadCustomers(signal, force), loadVehicles(signal, force), loadApplications(signal, force),
        loadTasks(signal, force), loadMaintenance(signal, force), loadNotifications(signal, force)
      ]);
      setState({
        customers: customers.records || [],
        vehicles: vehicles.records || [],
        applications: applications.items || [],
        tasks: tasks.records || [],
        maintenance: maintenance.records || [],
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
  const reviewApplications = state.applications.filter(item => !item.paid && isOpen(item.status));
  const paidPickups = state.applications.filter(item => item.paid && item.scheduledPickup);
  const openTasks = state.tasks.filter(task => isOpen(task.status));
  const dueService = state.maintenance.filter(job => isOpen(job.status) && !!(job.due || job.nextDue) && String(job.due || job.nextDue) <= today);
  const activeCustomers = state.customers.filter(customer => !/inactive|ended|removed|archived/i.test(customer.status || ''));
  const readyVehicles = state.vehicles.filter(vehicle => /ready|available|online|in lot/i.test(vehicle.status || ''));
  const priorities = useMemo(() => [
    ...paidPickups.map(item => ({ id: `pickup-${item.id}`, title: item.name || 'Approved customer', detail: `${item.vehicle || 'Vehicle'} | ${item.pickupDate || 'Pickup date needed'}`, status: 'Paid pickup', target: 'applications' })),
    ...reviewApplications.map(item => ({ id: `application-${item.id}`, title: item.name || 'New application', detail: item.vehicle || 'Vehicle not selected', status: item.status || 'Review', target: 'applications' })),
    ...dueService.map(job => ({ id: `service-${job.id}`, title: job.vehicle || 'Vehicle service', detail: job.issue || job.type || 'Maintenance due', status: job.status || 'Due', target: 'maintenance' })),
    ...openTasks.filter(task => !task.due || task.due <= today).map(task => ({ id: `task-${task.id}`, title: task.title || 'Open task', detail: [task.customer, task.vehicle].filter(Boolean).join(' | ') || 'Internal task', status: task.status || 'Open', target: 'dispatch' }))
  ].slice(0, 12), [dueService, openTasks, paidPickups, reviewApplications, today]);
  const sectionSwipe = useSwipeTabs(managerDashboardSections, section, onSectionChange);

  return <main className="dashboard-workspace manager-dashboard">
    <div className="dashboard-section-switch workspace-view-switch swipe-tabs" role="tablist" aria-label="Manager dashboard view" {...sectionSwipe}><button type="button" role="tab" aria-selected={section === 'overview'} className={section === 'overview' ? 'active' : ''} onClick={() => onSectionChange('overview')}>Overview</button><button type="button" role="tab" aria-selected={section === 'applications'} className={section === 'applications' ? 'active' : ''} onClick={() => onSectionChange('applications')}>Applications <b>{reviewApplications.length}</b></button></div>
    {section === 'applications' ? <ApplicationsPage onOpenRental={onOpenRental} embedded /> : <>
    <header className="page-heading"><div><span>Manager workspace</span><h1>Manager home</h1><p>Customers, applications, fleet, and daily work without owner payment or provider controls.</p></div><time>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</time></header>
    {error ? <div className="inline-alert error">{error}</div> : null}
    <section className="metric-strip" aria-label="Manager summary">
      <button onClick={() => onNavigate('applications')}><span>Applications</span><strong>{loading ? '...' : reviewApplications.length}</strong><small>{paidPickups.length} paid pickup{paidPickups.length === 1 ? '' : 's'}</small></button>
      <button onClick={() => onNavigate('customers')}><span>Active customers</span><strong>{loading ? '...' : activeCustomers.length}</strong><small>{state.customers.length} customer files</small></button>
      <button onClick={() => onNavigate('fleet')}><span>Fleet ready</span><strong>{loading ? '...' : readyVehicles.length}</strong><small>{state.vehicles.length} vehicles visible</small></button>
      <button onClick={() => onNavigate('dispatch')}><span>Open work</span><strong>{loading ? '...' : openTasks.length + dueService.length}</strong><small>{dueService.length} service due</small></button>
    </section>
    <div className="dashboard-grid">
      <section className="dashboard-panel priority-panel"><header><div><span>Today</span><h2>Manager queue</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Open dispatch</button></header>
        <div className="priority-list">{loading ? <div className="empty-state">Loading manager work...</div> : priorities.length ? priorities.map(item => <button key={item.id} onClick={() => onNavigate(item.target)}><span className={`status-line ${statusTone(item.status)}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.status}</b></button>) : <div className="empty-state compact">No urgent work is waiting.</div>}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Applications</span><h2>Onboarding flow</h2></div><button className="text-command" onClick={() => onNavigate('applications')}>Review applications</button></header>
        <div className="reconcile-list"><div><span>Needs review</span><strong>{reviewApplications.length}</strong></div><div><span>Paid pickup</span><strong>{paidPickups.length}</strong></div><div><span>Total visible</span><strong>{state.applications.length}</strong></div></div>
      </section>
      <section className="dashboard-panel"><header><div><span>Fleet pulse</span><h2>Availability</h2></div><button className="text-command" onClick={() => onNavigate('fleet')}>Open fleet</button></header>
        <div className="distribution-list">{['Assigned', 'Ready', 'Service', 'Prep', 'Online'].map(label => { const count = state.vehicles.filter(vehicle => new RegExp(label, 'i').test(vehicle.status || '')).length; const percent = state.vehicles.length ? Math.max(3, count / state.vehicles.length * 100) : 0; return <div key={label}><span><b>{label}</b><em>{count}</em></span><i><u style={{ width: `${percent}%` }} /></i></div>; })}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Activity</span><h2>Latest updates</h2></div><button className="text-command" onClick={() => onNavigate('messages')}>Open messages</button></header>
        <div className="activity-list">{state.notifications.slice(0, 7).map(notice => <article key={notice.id}><span className={`activity-mark ${statusTone(notice.tone || notice.type)}`} /><div><strong>{notice.title || notice.type || 'Platform update'}</strong><p>{notice.body || notice.message || 'New activity is available.'}</p><time>{dateTime(notice.createdAt || notice.date)}</time></div></article>)}{!state.notifications.length && !loading ? <div className="empty-state compact">No new manager notifications.</div> : null}</div>
      </section>
    </div>
    </>}
  </main>;
}
