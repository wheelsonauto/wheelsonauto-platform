import { useEffect, useMemo, useState } from 'react';
import { loadApplications, loadDashboardPriority, loadNotifications } from '../api';
import type { ApplicationItem, DashboardPriorityFeed, NotificationRecord } from '../types';
import { dateTime, money, statusTone } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { ApplicationsPage } from '../applications/ApplicationsPage';

type DashboardState = { applications: ApplicationItem[]; notifications: NotificationRecord[]; priority: DashboardPriorityFeed };

const emptyPriority: DashboardPriorityFeed = {
  ok: true,
  today: '',
  summary: { collectedAmount: 0, collectedCount: 0, dueCount: 0, priorDueCount: 0, failedOnceCount: 0, failedTwiceCount: 0, serviceNeededCount: 0, overdueDuesCount: 0, inspectionDueCount: 0, lateInspectionCount: 0, pickupsTodayCount: 0, returnsTodayCount: 0 },
  todayDue: [], priorDue: [], failedOnce: [], failedTwice: [], towCandidates: [], overdueDues: [], serviceNeeded: [], inspections: [], pickups: [], returns: [], transactionsToday: [], completedToday: []
};
const emptyState: DashboardState = { applications: [], notifications: [], priority: emptyPriority };

type DashboardSection = 'overview' | 'applications';
const dashboardSections: readonly DashboardSection[] = ['overview', 'applications'];

function dueDescription(daysLate = 0) {
  if (daysLate <= 0) return 'Due today';
  return `${daysLate} day${daysLate === 1 ? '' : 's'} late`;
}

export function DashboardPage({ onNavigate, onOpenRental, section, onSectionChange }: { onNavigate: (workspace: string, recordId?: string) => void; onOpenRental: (rentalId: string) => void; section: DashboardSection; onSectionChange: (section: DashboardSection) => void }) {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [applications, notifications, priority] = await Promise.all([
        loadApplications(signal, force), loadNotifications(signal, force), loadDashboardPriority(signal, force)
      ]);
      setState({ applications: applications.items || [], notifications: notifications.notifications || notifications.notices || notifications.items || [], priority });
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    let timer = 0;
    events.addEventListener('platform', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(undefined, true), 120);
    });
    return () => { controller.abort(); events.close(); window.clearTimeout(timer); };
  }, []);

  const reviewApplications = state.applications.filter(item => !item.paid && !/denied|removed|cancelled|complete/i.test(item.status || ''));
  const priority = state.priority;
  const priorityRows = useMemo(() => {
    const seen = new Set<string>();
    const rows = [
      ...priority.towCandidates.map(item => ({ id: `tow-${item.id}`, recordId: item.id, title: item.customer, detail: `${item.vehicle || 'Payment plan'} · ${money(item.amount)} · ${dueDescription(item.daysLate)}`, status: 'Tow review', target: 'payments' })),
      ...priority.failedTwice.map(item => ({ id: `failed2-${item.id}`, recordId: item.id, title: item.customer, detail: `${item.vehicle || 'Payment plan'} · ${money(item.amount)}${item.customerNotified ? ' · Customer notified' : ''}`, status: 'Failed twice', target: 'payments' })),
      ...priority.priorDue.map(item => ({ id: `late-${item.id}`, recordId: item.id, title: item.customer, detail: `${item.vehicle || 'Payment plan'} · ${money(item.amount)} · ${dueDescription(item.daysLate)}`, status: 'Past due', target: 'payments' })),
      ...priority.overdueDues.map(item => ({ id: `dues-${item.id}`, recordId: item.id, title: item.customer, detail: `${item.kind} · ${money(item.amount)} · ${dueDescription(item.daysLate)}`, status: 'Dues past due', target: 'customers' })),
      ...priority.serviceNeeded.map(item => ({ id: `service-${item.id}`, recordId: item.vehicleId, title: item.vehicle, detail: [item.customer, item.issue].filter(Boolean).join(' · '), status: item.status || 'Service needed', target: 'fleet' })),
      ...priority.inspections.filter(item => (item.daysLate || 0) >= 14).map(item => ({ id: `inspection-${item.id}`, recordId: item.vehicleId, title: item.vehicle, detail: `${item.customer || 'Customer'} · ${dueDescription(item.daysLate)}`, status: 'Inspection overdue', target: 'fleet' }))
    ];
    return rows.filter(row => { const key = `${row.target}:${row.recordId || row.title}:${row.status}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 14);
  }, [priority]);
  const paymentRows = [...priority.failedTwice, ...priority.failedOnce, ...priority.todayDue, ...priority.priorDue.filter(item => !priority.failedTwice.some(failed => failed.id === item.id) && !priority.failedOnce.some(failed => failed.id === item.id))];
  const scheduleRows = [
    ...priority.pickups.map(row => ({ ...row, kind: 'Pickup' })),
    ...priority.returns.map(row => ({ ...row, kind: 'Return' })),
    ...priority.inspections.map(row => ({ ...row, customer: row.customer || '', date: row.due || '', time: '', address: '', method: '', kind: 'Inspection' }))
  ].sort((left, right) => String(left.date + (left.time || '')).localeCompare(String(right.date + (right.time || ''))));
  const sectionSwipe = useSwipeTabs(dashboardSections, section, onSectionChange);

  return <main className="dashboard-workspace">
    <div className="dashboard-section-switch workspace-view-switch swipe-tabs" role="tablist" aria-label="Dashboard view" {...sectionSwipe}>
      <button type="button" role="tab" aria-selected={section === 'overview'} className={section === 'overview' ? 'active' : ''} onClick={() => onSectionChange('overview')}>Overview</button>
      <button type="button" role="tab" aria-selected={section === 'applications'} className={section === 'applications' ? 'active' : ''} onClick={() => onSectionChange('applications')}>Applications <b>{reviewApplications.length}</b></button>
    </div>
    {section === 'applications' ? <ApplicationsPage onOpenRental={onOpenRental} embedded /> : <>
      <header className="page-heading"><div><span>Daily operations</span><h1>Dashboard</h1><p>What needs attention, what is scheduled, and what finished today.</p></div><time>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</time></header>
      {error ? <div className="inline-alert error">{error}</div> : null}
      <section className="metric-strip" aria-label="Daily operations summary">
        <button onClick={() => onNavigate('payments')}><span>Collected today</span><strong>{loading ? '...' : money(priority.summary.collectedAmount)}</strong><small>{priority.summary.collectedCount} completed</small></button>
        <button onClick={() => onNavigate('payments')}><span>Due today</span><strong>{loading ? '...' : priority.summary.dueCount + priority.summary.failedOnceCount + priority.summary.failedTwiceCount}</strong><small>{priority.summary.failedTwiceCount} failed twice</small></button>
        <button onClick={() => onNavigate('customers')}><span>Past due</span><strong>{loading ? '...' : priority.summary.priorDueCount + priority.summary.overdueDuesCount}</strong><small>payments, tolls, and fees</small></button>
        <button onClick={() => onNavigate('dispatch')}><span>Today schedule</span><strong>{loading ? '...' : priority.summary.pickupsTodayCount + priority.summary.returnsTodayCount}</strong><small>{priority.summary.lateInspectionCount} late inspections</small></button>
      </section>
      <div className="dashboard-grid operations-command-grid">
        <section className="dashboard-panel priority-panel"><header><div><span>Act now</span><h2>Needs attention</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Open dispatch</button></header>
          <div className="priority-list">{loading ? <div className="empty-state">Loading today’s work...</div> : priorityRows.length ? priorityRows.map(item => <button key={item.id} onClick={() => onNavigate(item.target, item.recordId)}><span className={`status-line ${statusTone(item.status)}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>{item.status}</b></button>) : <div className="empty-state compact">No urgent work is waiting.</div>}</div>
        </section>
        <section className="dashboard-panel"><header><div><span>Payments</span><h2>Today and past due</h2></div><button className="text-command" onClick={() => onNavigate('payments')}>All payments</button></header>
          <div className="simple-list">{paymentRows.length ? paymentRows.slice(0, 10).map((payment, index) => <button key={`${payment.id}-${index}`} onClick={() => onNavigate('payments', payment.id)}><span><strong>{payment.customer}</strong><small>{[payment.vehicle, dueDescription(payment.daysLate), payment.customerNotified ? 'Notified' : 'Not notified'].filter(Boolean).join(' · ')}</small></span><b>{money(payment.amount)}</b><em className={`status-chip ${statusTone(payment.status)}`}>{payment.status}</em></button>) : <div className="empty-state compact">No payment action is waiting.</div>}</div>
        </section>
        <section className="dashboard-panel"><header><div><span>Schedule</span><h2>Pickups, returns, inspections</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Open schedule</button></header>
          <div className="simple-list">{scheduleRows.length ? scheduleRows.slice(0, 10).map((row, index) => <button key={`${row.kind}-${row.id}-${index}`} onClick={() => onNavigate(row.kind === 'Inspection' ? 'fleet' : 'dispatch', row.vehicleId || row.id)}><span><strong>{row.kind}: {row.customer || row.vehicle}</strong><small>{[row.vehicle, row.date, row.time, row.method, row.address].filter(Boolean).join(' · ')}</small></span><b>{row.date === priority.today ? 'Today' : row.date}</b></button>) : <div className="empty-state compact">No pickup, return, or inspection is scheduled.</div>}</div>
        </section>
        <section className="dashboard-panel"><header><div><span>Transactions</span><h2>Today’s complete record</h2></div><button className="text-command" onClick={() => onNavigate('payments')}>Transactions</button></header>
          <div className="simple-list">{priority.transactionsToday.length ? priority.transactionsToday.slice(0, 10).map(row => <button key={row.id} onClick={() => onNavigate('payments', row.id)}><span><strong>{row.customer}</strong><small>{[row.reason, row.method, dateTime(row.date)].filter(Boolean).join(' · ')}</small></span><b>{money(row.amount)}</b><em className={`status-chip ${statusTone(row.status)}`}>{row.status}</em></button>) : <div className="empty-state compact">No transactions recorded today.</div>}</div>
        </section>
        <section className="dashboard-panel"><header><div><span>Done today</span><h2>Completed actions</h2></div><span className="completed-count">{priority.completedToday.length}</span></header>
          <div className="activity-list">{priority.completedToday.slice(0, 10).map(row => <article key={`${row.title}-${row.id}`}><span className="activity-mark good" /><div><strong>{row.title}</strong><p>{row.detail || 'Completed today'}</p></div></article>)}{!priority.completedToday.length && !loading ? <div className="empty-state compact">Completed actions will collect here through the day.</div> : null}</div>
        </section>
        <section className="dashboard-panel"><header><div><span>Live updates</span><h2>Latest activity</h2></div><button className="text-command" onClick={() => onNavigate('messages')}>Messages</button></header>
          <div className="activity-list">{state.notifications.slice(0, 7).map(notice => <article key={notice.id}><span className={`activity-mark ${statusTone(notice.tone || notice.type)}`} /><div><strong>{notice.title || notice.type || 'Platform update'}</strong><p>{notice.body || notice.message || 'New activity is available.'}</p><time>{dateTime(notice.createdAt || notice.date)}</time></div></article>)}{!state.notifications.length && !loading ? <div className="empty-state compact">No new platform notifications.</div> : null}</div>
        </section>
      </div>
    </>}
  </main>;
}
