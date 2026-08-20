import { useEffect, useState } from 'react';
import { loadApplications, loadCustomers, loadDashboardPriority, loadNotifications, loadVehicles } from '../api';
import type { ApplicationItem, CustomerRecord, DashboardPriorityFeed, NotificationRecord, VehicleRecord } from '../types';
import { dateTime, money, statusTone } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { ApplicationsPage } from '../applications/ApplicationsPage';

type DashboardState = {
  customers: CustomerRecord[];
  vehicles: VehicleRecord[];
  applications: ApplicationItem[];
  notifications: NotificationRecord[];
  priority: DashboardPriorityFeed;
};

const emptyPriority: DashboardPriorityFeed = { ok: true, today: '', summary: { collectedAmount: 0, collectedCount: 0, dueCount: 0, failedTwiceCount: 0, serviceNeededCount: 0 }, todayDue: [], failedTwice: [], serviceNeeded: [] };
const emptyState: DashboardState = { customers: [], vehicles: [], applications: [], notifications: [], priority: emptyPriority };

type DashboardSection = 'overview' | 'applications';
const dashboardSections: readonly DashboardSection[] = ['overview', 'applications'];

export function DashboardPage({ onNavigate, onOpenRental, section, onSectionChange }: { onNavigate: (workspace: string, recordId?: string) => void; onOpenRental: (rentalId: string) => void; section: DashboardSection; onSectionChange: (section: DashboardSection) => void }) {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [customers, vehicles, applications, notifications, priority] = await Promise.all([
        loadCustomers(signal, force), loadVehicles(signal, force), loadApplications(signal, force), loadNotifications(signal, force), loadDashboardPriority(signal, force)
      ]);
      setState({
        customers: customers.records || [], vehicles: vehicles.records || [], applications: applications.items || [],
        notifications: notifications.notifications || notifications.notices || notifications.items || [], priority
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

  const reviewApplications = state.applications.filter(item => !item.paid && !/denied|removed|cancelled|complete/i.test(item.status || ''));
  const priorities = [
    ...state.priority.failedTwice.map(item => ({ id: `failed-${item.id}`, title: item.customer, detail: `${item.vehicle || 'Payment plan'} | ${money(item.amount)}`, status: 'Failed twice', target: 'payments' })),
    ...state.priority.todayDue.map(item => ({ id: `due-${item.id}`, title: item.customer, detail: `${item.vehicle || 'Payment plan'} | ${money(item.amount)} due today`, status: item.status || 'Due today', target: 'payments' })),
    ...state.priority.serviceNeeded.map(item => ({ id: `service-${item.id}`, title: item.vehicle || 'Vehicle service', detail: [item.customer, item.issue].filter(Boolean).join(' | '), status: item.status || 'Needs service', target: 'maintenance' }))
  ].slice(0, 10);
  const sectionSwipe = useSwipeTabs(dashboardSections, section, onSectionChange);

  return <main className="dashboard-workspace">
    <div className="dashboard-section-switch workspace-view-switch swipe-tabs" role="tablist" aria-label="Dashboard view" {...sectionSwipe}>
      <button type="button" role="tab" aria-selected={section === 'overview'} className={section === 'overview' ? 'active' : ''} onClick={() => onSectionChange('overview')}>Overview</button>
      <button type="button" role="tab" aria-selected={section === 'applications'} className={section === 'applications' ? 'active' : ''} onClick={() => onSectionChange('applications')}>Applications <b>{reviewApplications.length}</b></button>
    </div>
    {section === 'applications' ? <ApplicationsPage onOpenRental={onOpenRental} embedded /> : <>
    <header className="page-heading"><div><span>Live command center</span><h1>Dashboard</h1><p>Money, customers, fleet, and work that needs attention now.</p></div><time>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</time></header>
    {error ? <div className="inline-alert error">{error}</div> : null}
    <section className="metric-strip" aria-label="Business summary">
      <button onClick={() => onNavigate('payments')}><span>Collected today</span><strong>{loading ? '...' : money(state.priority.summary.collectedAmount)}</strong><small>{state.priority.summary.collectedCount} payment{state.priority.summary.collectedCount === 1 ? '' : 's'}</small></button>
      <button onClick={() => onNavigate('applications')}><span>Applications</span><strong>{loading ? '...' : reviewApplications.length}</strong><small>awaiting review</small></button>
      <button onClick={() => onNavigate('fleet')}><span>Fleet</span><strong>{loading ? '...' : state.vehicles.length}</strong><small>{state.vehicles.filter(row => /ready|available|online/i.test(row.status || '')).length} ready</small></button>
      <button onClick={() => onNavigate('payments')}><span>Money due</span><strong>{loading ? '...' : state.priority.summary.dueCount + state.priority.summary.failedTwiceCount}</strong><small>{state.priority.summary.failedTwiceCount} failed twice</small></button>
    </section>
    <div className="dashboard-grid">
      <section className="dashboard-panel priority-panel"><header><div><span>Today</span><h2>Priority queue</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Open dispatch</button></header>
        <div className="priority-list">{loading ? <div className="empty-state">Loading priorities...</div> : priorities.length ? priorities.map(item => <button key={item.id} onClick={() => onNavigate(item.target)}><span className={`status-line ${statusTone(item.status)}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.status}</b></button>) : <div className="empty-state compact">No urgent work is waiting.</div>}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Payments</span><h2>Today & failed twice</h2></div><button className="text-command" onClick={() => onNavigate('payments')}>View payments</button></header>
        <div className="simple-list">{[...state.priority.failedTwice, ...state.priority.todayDue].length ? [...state.priority.failedTwice, ...state.priority.todayDue].slice(0, 8).map(payment => <button key={`${payment.status}-${payment.id}`} onClick={() => onNavigate('payments')}><span><strong>{payment.customer || 'Customer'}</strong><small>{payment.vehicle || `${payment.nextRun || 'Today'} ${payment.chargeTime || ''}`}</small></span><b>{money(payment.amount)}</b><em className={`status-chip ${statusTone(payment.status)}`}>{payment.status}</em></button>) : <div className="empty-state compact">Today is caught up. No customer has failed twice.</div>}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Activity</span><h2>Latest updates</h2></div><button className="text-command" onClick={() => onNavigate('messages')}>Open messages</button></header>
        <div className="activity-list">{state.notifications.slice(0, 7).map(notice => <article key={notice.id}><span className={`activity-mark ${statusTone(notice.tone || notice.type)}`} /><div><strong>{notice.title || notice.type || 'Platform update'}</strong><p>{notice.body || notice.message || 'New activity is available.'}</p><time>{dateTime(notice.createdAt || notice.date)}</time></div></article>)}{!state.notifications.length && !loading ? <div className="empty-state compact">No new platform notifications.</div> : null}</div>
      </section>
      <section className="dashboard-panel"><header><div><span>Fleet pulse</span><h2>Availability</h2></div><button className="text-command" onClick={() => onNavigate('fleet')}>Open fleet</button></header>
        <div className="distribution-list">{['Assigned', 'Ready', 'Service', 'Prep', 'Online'].map(label => { const count = state.vehicles.filter(vehicle => new RegExp(label, 'i').test(vehicle.status || '')).length; const percent = state.vehicles.length ? Math.max(3, count / state.vehicles.length * 100) : 0; return <div key={label}><span><b>{label}</b><em>{count}</em></span><i><u style={{ width: `${percent}%` }} /></i></div>; })}</div>
      </section>
    </div>
    </>}
  </main>;
}
