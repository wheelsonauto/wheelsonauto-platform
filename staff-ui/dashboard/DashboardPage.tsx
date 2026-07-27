import { useEffect, useMemo, useState } from 'react';
import { loadApplications, loadCustomers, loadMaintenance, loadNotifications, loadPayments, loadTasks, loadVehicles } from '../api';
import type { ApplicationItem, CustomerRecord, MaintenanceRecord, NotificationRecord, PaymentRecord, TaskRecord, VehicleRecord } from '../types';
import { dateTime, money, statusTone } from '../ui';

type DashboardState = {
  customers: CustomerRecord[];
  vehicles: VehicleRecord[];
  payments: PaymentRecord[];
  applications: ApplicationItem[];
  tasks: TaskRecord[];
  maintenance: MaintenanceRecord[];
  notifications: NotificationRecord[];
};

const emptyState: DashboardState = { customers: [], vehicles: [], payments: [], applications: [], tasks: [], maintenance: [], notifications: [] };

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function DashboardPage({ onNavigate }: { onNavigate: (workspace: string) => void }) {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [customers, vehicles, payments, applications, tasks, maintenance, notifications] = await Promise.all([
        loadCustomers(signal, force), loadVehicles(signal, force), loadPayments(signal, force), loadApplications(signal, force), loadTasks(signal, force), loadMaintenance(signal, force), loadNotifications(signal, force)
      ]);
      setState({
        customers: customers.records || [], vehicles: vehicles.records || [], payments: payments.records || [], applications: applications.items || [],
        tasks: tasks.records || [], maintenance: maintenance.records || [], notifications: notifications.notifications || notifications.notices || notifications.items || []
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
  const paidToday = useMemo(() => state.payments.filter(payment => {
    const date = new Date(payment.createdAt || payment.date || '');
    return !Number.isNaN(date.getTime()) && date.toLocaleDateString('en-CA') === today && /paid|complete|succeeded/i.test(payment.status || '');
  }), [state.payments, today]);
  const openTasks = state.tasks.filter(task => !/done|closed|complete/i.test(task.status || ''));
  const dueService = state.maintenance.filter(job => !/complete|closed|fixed/i.test(job.status || '') && !!(job.due || job.nextDue) && (job.due || job.nextDue || '') <= today);
  const reviewApplications = state.applications.filter(item => !item.paid && !/denied|removed|cancelled|complete/i.test(item.status || ''));
  const failedPayments = state.payments.filter(payment => /failed|declined|payment not found/i.test(payment.status || '')).slice(0, 6);
  const priorities = [
    ...state.applications.filter(item => item.paid && item.scheduledPickup).map(item => ({ id: `app-${item.id}`, title: item.name, detail: `${item.vehicle || 'Vehicle'} | Pickup ${item.pickupDate || 'not scheduled'}`, status: 'Paid pickup', target: 'applications' })),
    ...openTasks.filter(task => task.due && task.due <= today).map(task => ({ id: `task-${task.id}`, title: task.title, detail: [task.customer, task.vehicle].filter(Boolean).join(' | ') || 'Internal task', status: task.status || 'Open', target: 'dispatch' })),
    ...dueService.map(job => ({ id: `job-${job.id}`, title: job.vehicle || 'Vehicle service', detail: job.issue || job.type || 'Maintenance due', status: job.status || 'Due', target: 'maintenance' }))
  ].slice(0, 10);

  return <main className="dashboard-workspace">
    <header className="page-heading"><div><span>Live command center</span><h1>Dashboard</h1><p>Money, customers, fleet, and work that needs attention now.</p></div><time>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</time></header>
    {error ? <div className="inline-alert error">{error}</div> : null}
    <section className="metric-strip" aria-label="Business summary">
      <button onClick={() => onNavigate('payments')}><span>Collected today</span><strong>{loading ? '...' : money(paidToday.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong><small>{paidToday.length} payment{paidToday.length === 1 ? '' : 's'}</small></button>
      <button onClick={() => onNavigate('applications')}><span>Applications</span><strong>{loading ? '...' : reviewApplications.length}</strong><small>awaiting review</small></button>
      <button onClick={() => onNavigate('fleet')}><span>Fleet</span><strong>{loading ? '...' : state.vehicles.length}</strong><small>{state.vehicles.filter(row => /ready|available|online/i.test(row.status || '')).length} ready</small></button>
      <button onClick={() => onNavigate('dispatch')}><span>Open work</span><strong>{loading ? '...' : openTasks.length + dueService.length}</strong><small>{dueService.length} service due</small></button>
    </section>
    <div className="dashboard-grid">
      <section className="dashboard-panel priority-panel"><header><div><span>Today</span><h2>Priority queue</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Open dispatch</button></header>
        <div className="priority-list">{loading ? <div className="empty-state">Loading priorities...</div> : priorities.length ? priorities.map(item => <button key={item.id} onClick={() => onNavigate(item.target)}><span className={`status-line ${statusTone(item.status)}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.status}</b></button>) : <div className="empty-state compact">No urgent work is waiting.</div>}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Payments</span><h2>Exceptions</h2></div><button className="text-command" onClick={() => onNavigate('payments')}>View payments</button></header>
        <div className="simple-list">{failedPayments.length ? failedPayments.map(payment => <button key={payment.id} onClick={() => onNavigate('payments')}><span><strong>{payment.customer || 'Unmatched payment'}</strong><small>{payment.vehicle || payment.method || payment.source || 'Payment record'}</small></span><b>{money(payment.amount)}</b><em className={`status-chip ${statusTone(payment.status)}`}>{payment.status || 'Review'}</em></button>) : <div className="empty-state compact">No failed payments in this feed.</div>}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Activity</span><h2>Latest updates</h2></div><button className="text-command" onClick={() => onNavigate('messages')}>Open messages</button></header>
        <div className="activity-list">{state.notifications.slice(0, 7).map(notice => <article key={notice.id}><span className={`activity-mark ${statusTone(notice.tone || notice.type)}`} /><div><strong>{notice.title || notice.type || 'Platform update'}</strong><p>{notice.body || notice.message || 'New activity is available.'}</p><time>{dateTime(notice.createdAt || notice.date)}</time></div></article>)}{!state.notifications.length && !loading ? <div className="empty-state compact">No new platform notifications.</div> : null}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Fleet pulse</span><h2>Availability</h2></div><button className="text-command" onClick={() => onNavigate('fleet')}>Open fleet</button></header>
        <div className="distribution-list">{['Assigned', 'Ready', 'Service', 'Prep', 'Online'].map(label => { const count = state.vehicles.filter(vehicle => new RegExp(label, 'i').test(vehicle.status || '')).length; const percent = state.vehicles.length ? Math.max(3, count / state.vehicles.length * 100) : 0; return <div key={label}><span><b>{label}</b><em>{count}</em></span><i><u style={{ width: `${percent}%` }} /></i></div>; })}</div>
      </section>
    </div>
  </main>;
}
