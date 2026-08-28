import { useEffect, useState } from 'react';
import { loadApplications, loadDashboardPriority } from '../api';
import type { ApplicationItem, DashboardPriorityFeed } from '../types';
import { dateTime, money, shortDate, statusTone } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { ApplicationsPage } from '../applications/ApplicationsPage';

type DashboardState = { applications: ApplicationItem[]; priority: DashboardPriorityFeed };

const emptyPriority: DashboardPriorityFeed = {
  ok: true,
  today: '',
  summary: { collectedAmount: 0, collectedCount: 0, dueCount: 0, priorDueCount: 0, failedOnceCount: 0, failedTwiceCount: 0, serviceNeededCount: 0, overdueDuesCount: 0, inspectionDueCount: 0, lateInspectionCount: 0, pickupsTodayCount: 0, returnsTodayCount: 0 },
  todayDue: [], priorDue: [], failedOnce: [], failedTwice: [], towCandidates: [], overdueDues: [], serviceNeeded: [], inspections: [], pickups: [], returns: [], todayCustomers: [], transactions: [], transactionsToday: [], maintenanceAppointments: [], overdueService: [], overdueBalances: [], completedToday: []
};
const emptyState: DashboardState = { applications: [], priority: emptyPriority };

type DashboardSection = 'overview' | 'applications';
type DashboardPanel = 'customers' | 'transactions' | 'schedule' | 'service' | 'past-due';
const dashboardSections: readonly DashboardSection[] = ['overview', 'applications'];
const dashboardPanels: readonly DashboardPanel[] = ['customers', 'transactions', 'schedule', 'service', 'past-due'];
const dashboardPanelLabels: Record<DashboardPanel, string> = { customers: 'Today', transactions: 'Transactions', schedule: 'Schedule', service: 'Service', 'past-due': 'Past due' };

function businessDateKey(value?: string) {
  return String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
}

function daysLateText(daysLate = 0) {
  return `${daysLate} day${daysLate === 1 ? '' : 's'} past due`;
}

export function DashboardPage({ onNavigate, onOpenRental, section, onSectionChange }: { onNavigate: (workspace: string, recordId?: string) => void; onOpenRental: (rentalId: string) => void; section: DashboardSection; onSectionChange: (section: DashboardSection) => void }) {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobilePanel, setMobilePanel] = useState<DashboardPanel>('customers');
  const [transactionScope, setTransactionScope] = useState<'today' | 'history'>('today');
  const [transactionQuery, setTransactionQuery] = useState('');
  const [transactionFrom, setTransactionFrom] = useState('');
  const [transactionTo, setTransactionTo] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [applications, priority] = await Promise.all([loadApplications(signal, force), loadDashboardPriority(signal, force)]);
      setState({ applications: applications.items || [], priority });
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
  const todayStatusCounts = priority.todayCustomers.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  const pastDueTotal = priority.overdueBalances.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const scheduleRows = [
    ...priority.pickups.filter(row => row.date === priority.today).map(row => ({ ...row, kind: 'Pickup', target: 'dispatch' })),
    ...priority.returns.filter(row => row.date === priority.today).map(row => ({ ...row, kind: 'Return', target: 'dispatch' })),
    ...priority.maintenanceAppointments.map(row => ({ ...row, kind: row.method || 'Service', target: 'fleet' }))
  ].sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')));
  const transactions = (() => {
    const query = transactionQuery.trim().toLowerCase();
    return priority.transactions.filter(row => {
      const rowDate = businessDateKey(row.date);
      if (transactionScope === 'today' && rowDate !== priority.today) return false;
      if (transactionScope === 'history' && transactionFrom && rowDate < transactionFrom) return false;
      if (transactionScope === 'history' && transactionTo && rowDate > transactionTo) return false;
      return !query || [row.customer, row.vehicle, row.amount, row.status, row.method, row.reason, row.cardLast4, row.date].join(' ').toLowerCase().includes(query);
    });
  })();
  const sectionSwipe = useSwipeTabs(dashboardSections, section, onSectionChange);
  const panelSwipe = useSwipeTabs(dashboardPanels, mobilePanel, setMobilePanel);
  const panelClass = (panel: DashboardPanel, extra = '') => `dashboard-panel dashboard-focus-panel ${mobilePanel === panel ? 'mobile-active' : 'mobile-hidden'} ${extra}`.trim();

  return <main className="dashboard-workspace">
    <div className="dashboard-section-switch workspace-view-switch swipe-tabs" role="tablist" aria-label="Dashboard view" {...sectionSwipe}>
      <button type="button" role="tab" aria-selected={section === 'overview'} className={section === 'overview' ? 'active' : ''} onClick={() => onSectionChange('overview')}>Overview</button>
      <button type="button" role="tab" aria-selected={section === 'applications'} className={section === 'applications' ? 'active' : ''} onClick={() => onSectionChange('applications')}>Applications <b>{reviewApplications.length}</b></button>
    </div>
    {section === 'applications' ? <ApplicationsPage onOpenRental={onOpenRental} embedded /> : <>
      <header className="page-heading dashboard-heading"><div><span>Daily operations</span><h1>Dashboard</h1><p>Today’s billing, appointments, overdue service, and customer balances.</p></div><time>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</time></header>
      {error ? <div className="inline-alert error">{error}</div> : null}
      <section className="metric-strip dashboard-metrics" aria-label="Daily operations summary">
        <button onClick={() => setMobilePanel('transactions')}><span>Collected today</span><strong>{money(priority.summary.collectedAmount)}</strong><small>{priority.summary.collectedCount} successful transactions</small></button>
        <button onClick={() => setMobilePanel('customers')}><span>Today’s customers</span><strong>{priority.todayCustomers.length}</strong><small>{todayStatusCounts['Failed twice'] || 0} failed twice · {todayStatusCounts.Pending || 0} pending</small></button>
        <button onClick={() => setMobilePanel('schedule')}><span>Scheduled today</span><strong>{scheduleRows.length}</strong><small>pickup, return, inspection, and service</small></button>
        <button onClick={() => setMobilePanel('past-due')}><span>Past-due balance</span><strong>{money(pastDueTotal)}</strong><small>{priority.overdueBalances.length} customer items</small></button>
      </section>
      <div className="dashboard-panel-switch swipe-tabs" role="tablist" aria-label="Dashboard panels" {...panelSwipe}>{dashboardPanels.map(panel => <button type="button" role="tab" key={panel} aria-selected={mobilePanel === panel} className={mobilePanel === panel ? 'active' : ''} onClick={() => setMobilePanel(panel)}>{dashboardPanelLabels[panel]}</button>)}</div>
      <div className="dashboard-grid dashboard-focused-grid">
        <section className={panelClass('customers')}><header><div><span>Billing</span><h2>Today’s customers</h2></div><button className="text-command" onClick={() => onNavigate('payments')}>Payments</button></header>
          <div className="simple-list dashboard-panel-list">{loading ? <div className="empty-state compact">Loading today’s customers...</div> : priority.todayCustomers.length ? priority.todayCustomers.map(row => <button key={row.id} onClick={() => onNavigate('payments', row.id)}><span><strong>{row.customer}</strong><small>{[row.vehicle || 'Vehicle not linked', money(row.amount), row.cardLast4 ? `card ending ${row.cardLast4}` : 'card ending not recorded'].join(' · ')}</small></span><em className={`status-chip ${statusTone(row.status)}`}>{row.status}</em></button>) : <div className="empty-state compact">No customers are scheduled to pay today.</div>}</div>
        </section>

        <section className={panelClass('schedule')}><header><div><span>Schedule</span><h2>Today’s appointments</h2></div><button className="text-command" onClick={() => onNavigate('dispatch')}>Schedule</button></header>
          <div className="simple-list dashboard-panel-list">{scheduleRows.length ? scheduleRows.map(row => <button key={`${row.kind}-${row.id}`} onClick={() => onNavigate(row.target, row.vehicleId || row.id)}><span><strong>{row.customer}</strong><small>{[row.kind, row.vehicle, row.status].filter(Boolean).join(' · ')}</small></span><b>{row.time || 'Time not set'}</b></button>) : <div className="empty-state compact">No pickups, returns, inspections, or services are scheduled today.</div>}</div>
        </section>

        <section className={panelClass('transactions', 'dashboard-wide-panel dashboard-transactions-panel')}><header><div><span>Money</span><h2>Transactions</h2></div><span className="completed-count">{transactions.length}</span></header>
          <div className="dashboard-transaction-tools">
            <div className="dashboard-scope-control"><button type="button" className={transactionScope === 'today' ? 'active' : ''} onClick={() => setTransactionScope('today')}>Today</button><button type="button" className={transactionScope === 'history' ? 'active' : ''} onClick={() => setTransactionScope('history')}>History</button></div>
            <input type="search" value={transactionQuery} onChange={event => setTransactionQuery(event.target.value)} placeholder="Search name, vehicle, card, amount" aria-label="Search transactions" />
            {transactionScope === 'history' ? <div className="dashboard-date-filter"><label>From<input type="date" value={transactionFrom} onChange={event => setTransactionFrom(event.target.value)} /></label><label>To<input type="date" value={transactionTo} onChange={event => setTransactionTo(event.target.value)} /></label><button type="button" className="text-command" onClick={() => { setTransactionFrom(''); setTransactionTo(''); }}>All dates</button></div> : null}
          </div>
          <div className="simple-list dashboard-panel-list transaction-dashboard-list">{transactions.length ? transactions.map(row => <button key={row.id} onClick={() => onNavigate('payments', row.id)}><span><strong>{row.customer}</strong><small>{[row.vehicle || 'Vehicle not recorded', dateTime(row.date), row.cardLast4 ? `card ending ${row.cardLast4}` : 'card ending not recorded', row.method].filter(Boolean).join(' · ')}</small></span><b>{money(row.amount)}</b><em className={`status-chip ${statusTone(row.status)}`}>{row.status}</em></button>) : <div className="empty-state compact">No transactions match these filters.</div>}</div>
        </section>

        <section className={panelClass('service')}><header><div><span>Fleet care</span><h2>Overdue maintenance &amp; service</h2></div><button className="text-command" onClick={() => onNavigate('fleet')}>Fleet</button></header>
          <div className="simple-list dashboard-panel-list">{priority.overdueService.length ? priority.overdueService.map(row => <button key={row.id} onClick={() => onNavigate('fleet', row.vehicleId || row.id)}><span><strong>{row.vehicle}</strong><small>{[row.customer, row.kind || 'Service', row.issue, `due ${shortDate(row.due)}`].filter(Boolean).join(' · ')}</small></span><b>{daysLateText(row.daysLate)}</b></button>) : <div className="empty-state compact">No maintenance or service is overdue.</div>}</div>
        </section>

        <section className={panelClass('past-due')}><header><div><span>Collections</span><h2>Past-due customer balances</h2></div><button className="text-command" onClick={() => onNavigate('customers')}>Customer dues</button></header>
          <div className="simple-list dashboard-panel-list">{priority.overdueBalances.length ? priority.overdueBalances.map(row => <button key={`${row.reason}-${row.id}`} onClick={() => onNavigate(row.reason === 'Recurring payment' ? 'payments' : 'customers', row.id)}><span><strong>{row.customer}</strong><small>{[row.vehicle, row.reason, `due ${shortDate(row.due)}`, daysLateText(row.daysLate)].filter(Boolean).join(' · ')}</small></span><b>{money(row.amount)}</b></button>) : <div className="empty-state compact">No customer balances are past due.</div>}</div>
        </section>
      </div>
    </>}
  </main>;
}
