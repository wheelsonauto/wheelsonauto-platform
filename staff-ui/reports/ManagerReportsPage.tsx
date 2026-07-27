import { useEffect, useMemo, useState } from 'react';
import { loadApplications, loadCustomers, loadMaintenance, loadTasks, loadVehicles } from '../api';
import type { ApplicationItem, CustomerRecord, MaintenanceRecord, TaskRecord, VehicleRecord } from '../types';

type ReportState = {
  customers: CustomerRecord[];
  vehicles: VehicleRecord[];
  applications: ApplicationItem[];
  tasks: TaskRecord[];
  maintenance: MaintenanceRecord[];
};

const emptyState: ReportState = { customers: [], vehicles: [], applications: [], tasks: [], maintenance: [] };

function openStatus(status = '') {
  return !/done|closed|complete|fixed|cancelled|removed|denied/i.test(status);
}

export function ManagerReportsPage({ onNavigate }: { onNavigate: (workspace: string) => void }) {
  const [state, setState] = useState<ReportState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [customers, vehicles, applications, tasks, maintenance] = await Promise.all([
        loadCustomers(signal, force), loadVehicles(signal, force), loadApplications(signal, force), loadTasks(signal, force), loadMaintenance(signal, force)
      ]);
      setState({ customers: customers.records || [], vehicles: vehicles.records || [], applications: applications.items || [], tasks: tasks.records || [], maintenance: maintenance.records || [] });
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

  const fleetGroups = useMemo(() => ['Assigned', 'Ready', 'Online', 'Prep', 'Service'].map(label => ({ label, count: state.vehicles.filter(row => new RegExp(label, 'i').test(row.status || '')).length })), [state.vehicles]);
  const applicationGroups = useMemo(() => [
    { label: 'Needs review', count: state.applications.filter(row => !row.paid && openStatus(row.status)).length },
    { label: 'Paid pickup', count: state.applications.filter(row => row.paid && row.scheduledPickup).length },
    { label: 'Completed', count: state.applications.filter(row => /complete|picked up|active/i.test(row.status || '')).length }
  ], [state.applications]);
  const openJobs = state.maintenance.filter(row => openStatus(row.status));
  const openTasks = state.tasks.filter(row => openStatus(row.status));
  const activeCustomers = state.customers.filter(row => !/inactive|ended|removed|archived/i.test(row.status || ''));

  return <main className="report-workspace manager-reports"><header className="page-heading"><div><span>Manager reporting</span><h1>Operations report</h1><p>Current customer, fleet, application, and service health. Owner money and provider data stay private.</p></div><time>Live snapshot</time></header>
    {error ? <div className="inline-alert error">{error}</div> : null}
    <section className="metric-strip"><button onClick={() => onNavigate('customers')}><span>Active customers</span><strong>{loading ? '...' : activeCustomers.length}</strong><small>{state.customers.length} files visible</small></button><button onClick={() => onNavigate('fleet')}><span>Fleet</span><strong>{loading ? '...' : state.vehicles.length}</strong><small>{fleetGroups.find(row => row.label === 'Ready')?.count || 0} ready</small></button><button onClick={() => onNavigate('applications')}><span>Applications</span><strong>{loading ? '...' : state.applications.length}</strong><small>{applicationGroups[0].count} need review</small></button><button onClick={() => onNavigate('maintenance')}><span>Open service</span><strong>{loading ? '...' : openJobs.length}</strong><small>{openTasks.length} open tasks</small></button></section>
    <div className="report-grid">
      <section className="dashboard-panel"><header><div><span>Fleet</span><h2>Status distribution</h2></div><button className="text-command" onClick={() => onNavigate('fleet')}>Open fleet</button></header><div className="reconcile-list">{fleetGroups.map(row => <div key={row.label}><span>{row.label}</span><strong>{row.count}</strong></div>)}</div></section>
      <section className="dashboard-panel"><header><div><span>Applications</span><h2>Onboarding pipeline</h2></div><button className="text-command" onClick={() => onNavigate('applications')}>Open applications</button></header><div className="reconcile-list">{applicationGroups.map(row => <div key={row.label}><span>{row.label}</span><strong>{row.count}</strong></div>)}</div></section>
      <section className="dashboard-panel"><header><div><span>Service</span><h2>Maintenance health</h2></div><button className="text-command" onClick={() => onNavigate('maintenance')}>Open maintenance</button></header><div className="reconcile-list"><div><span>Open jobs</span><strong>{openJobs.length}</strong></div><div><span>Completed history</span><strong>{state.maintenance.length - openJobs.length}</strong></div><div><span>Open dispatch tasks</span><strong>{openTasks.length}</strong></div></div></section>
      <section className="dashboard-panel"><header><div><span>Customers</span><h2>Account activity</h2></div><button className="text-command" onClick={() => onNavigate('customers')}>Open customers</button></header><div className="reconcile-list"><div><span>Active</span><strong>{activeCustomers.length}</strong></div><div><span>History / inactive</span><strong>{Math.max(0, state.customers.length - activeCustomers.length)}</strong></div><div><span>Total visible</span><strong>{state.customers.length}</strong></div></div></section>
    </div>
  </main>;
}
