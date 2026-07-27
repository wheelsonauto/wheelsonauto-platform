import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { loadNotifications, prewarmStaffFeeds } from './api';

const DashboardPage = lazy(() => import('./dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })));
const ManagerDashboardPage = lazy(() => import('./dashboard/ManagerDashboardPage').then(module => ({ default: module.ManagerDashboardPage })));
const ServiceDashboardPage = lazy(() => import('./dashboard/ServiceDashboardPage').then(module => ({ default: module.ServiceDashboardPage })));
const loadFleetModule = () => import('./fleet/FleetPage');
const loadCustomersModule = () => import('./customers/CustomersPage');
const loadPaymentsModule = () => import('./payments/PaymentsPage');
const loadMessagesModule = () => import('./messages/MessagesPage');
const loadMoreModule = () => import('./more/MorePage');
const loadApplicationsModule = () => import('./applications/ApplicationsPage');
const loadDispatchModule = () => import('./dispatch/DispatchPage');
const loadMaintenanceModule = () => import('./maintenance/MaintenancePage');
const loadAccountingModule = () => import('./accounting/AccountingPage');
const loadManagerReportsModule = () => import('./reports/ManagerReportsPage');
const loadSettingsModule = () => import('./settings/SettingsPage');
const loadRentalModule = () => import('./rentals/RentalFilePage');
const FleetPage = lazy(() => loadFleetModule().then(module => ({ default: module.FleetPage })));
const CustomersPage = lazy(() => loadCustomersModule().then(module => ({ default: module.CustomersPage })));
const PaymentsPage = lazy(() => loadPaymentsModule().then(module => ({ default: module.PaymentsPage })));
const ApplicationsPage = lazy(() => loadApplicationsModule().then(module => ({ default: module.ApplicationsPage })));
const MessagesPage = lazy(() => loadMessagesModule().then(module => ({ default: module.MessagesPage })));
const DispatchPage = lazy(() => loadDispatchModule().then(module => ({ default: module.DispatchPage })));
const MaintenancePage = lazy(() => loadMaintenanceModule().then(module => ({ default: module.MaintenancePage })));
const AccountingPage = lazy(() => loadAccountingModule().then(module => ({ default: module.AccountingPage })));
const ManagerReportsPage = lazy(() => loadManagerReportsModule().then(module => ({ default: module.ManagerReportsPage })));
const SystemsPage = lazy(() => import('./systems/SystemsPage').then(module => ({ default: module.SystemsPage })));
const MorePage = lazy(() => loadMoreModule().then(module => ({ default: module.MorePage })));
const SettingsPage = lazy(() => loadSettingsModule().then(module => ({ default: module.SettingsPage })));
const RentalFilePage = lazy(() => loadRentalModule().then(module => ({ default: module.RentalFilePage })));

type Workspace = 'dashboard' | 'fleet' | 'customers' | 'payments' | 'applications' | 'messages' | 'dispatch' | 'maintenance' | 'accounting' | 'reports' | 'systems' | 'more' | 'settings' | 'rental';
type NavItem = { id: Workspace; label: string; mark: string };
type StaffRole = 'owner' | 'manager' | 'mechanic';

const ownerNavGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Daily', items: [
    { id: 'dashboard', label: 'Dashboard', mark: '▦' },
    { id: 'messages', label: 'Messages', mark: '□' }
  ] },
  { label: 'Business', items: [
    { id: 'fleet', label: 'Fleet', mark: '◇' },
    { id: 'customers', label: 'Customers', mark: '○' },
    { id: 'payments', label: 'Payments', mark: '$' },
    { id: 'applications', label: 'Applications', mark: '◫' }
  ] },
  { label: 'Operations', items: [
    { id: 'dispatch', label: 'Dispatch', mark: '✓' },
    { id: 'maintenance', label: 'Maintenance', mark: '+' },
    { id: 'accounting', label: 'Accounting', mark: '∑' },
    { id: 'systems', label: 'Systems', mark: '⌁' }
  ] }
];

const ownerMobileItems: NavItem[] = [
  { id: 'dashboard', label: 'Home', mark: '▦' },
  { id: 'fleet', label: 'Fleet', mark: '◇' },
  { id: 'customers', label: 'Customers', mark: '○' },
  { id: 'messages', label: 'Messages', mark: '□' },
  { id: 'more', label: 'More', mark: '···' }
];

const workspaceNames = new Map<Workspace, string>([
  ...ownerNavGroups.flatMap(group => group.items.map(item => [item.id, item.label] as [Workspace, string])),
  ['reports', 'Reports'], ['more', 'More'], ['settings', 'Settings'], ['rental', 'Rental File']
]);

const roleWorkspaceAccess: Record<StaffRole, Set<Workspace>> = {
  owner: new Set(Array.from(workspaceNames.keys()).filter((workspace) => workspace !== 'reports')),
  manager: new Set(['dashboard', 'fleet', 'customers', 'applications', 'messages', 'dispatch', 'maintenance', 'reports', 'more', 'settings', 'rental']),
  mechanic: new Set(['dashboard', 'fleet', 'dispatch', 'maintenance', 'more', 'settings'])
};

function staffRole(): StaffRole {
  const role = String(window.__WOA_STAFF_USER__?.role || 'owner').toLowerCase();
  return role === 'mechanic' ? 'mechanic' : role === 'manager' ? 'manager' : 'owner';
}

function navigationForRole(role: StaffRole) {
  const allowed = roleWorkspaceAccess[role];
  if (role === 'mechanic') return [
    { label: 'Today', items: [
      { id: 'dashboard', label: 'Service home', mark: '▦' },
      { id: 'dispatch', label: 'Work queue', mark: '✓' }
    ] as NavItem[] },
    { label: 'Shop', items: [
      { id: 'fleet', label: 'Vehicles', mark: '◇' },
      { id: 'maintenance', label: 'Maintenance', mark: '+' }
    ] as NavItem[] }
  ];
  if (role === 'manager') return [
    { label: 'Daily', items: [
      { id: 'dashboard', label: 'Manager home', mark: '▦' },
      { id: 'messages', label: 'Messages', mark: '□' }
    ] as NavItem[] },
    { label: 'Business', items: [
      { id: 'fleet', label: 'Fleet', mark: '◇' },
      { id: 'customers', label: 'Customers', mark: '○' },
      { id: 'applications', label: 'Applications', mark: '◫' }
    ] as NavItem[] },
    { label: 'Operations', items: [
      { id: 'dispatch', label: 'Dispatch', mark: '✓' },
      { id: 'maintenance', label: 'Maintenance', mark: '+' },
      { id: 'reports', label: 'Reports', mark: '∑' }
    ] as NavItem[] }
  ];
  return ownerNavGroups.map(group => ({ ...group, items: group.items.filter(item => allowed.has(item.id)) })).filter(group => group.items.length);
}

function mobileNavigationForRole(role: StaffRole): NavItem[] {
  if (role === 'mechanic') return [
    { id: 'dashboard', label: 'Home', mark: '▦' },
    { id: 'dispatch', label: 'Work', mark: '✓' },
    { id: 'fleet', label: 'Vehicles', mark: '◇' },
    { id: 'maintenance', label: 'Service', mark: '+' },
    { id: 'more', label: 'More', mark: '···' }
  ];
  return ownerMobileItems;
}

function routeFromHash(): { workspace: Workspace; recordId: string } {
  const [rawWorkspace, ...recordParts] = window.location.hash.replace(/^#/, '').split('/');
  const workspace = rawWorkspace.toLowerCase() as Workspace;
  return workspaceNames.has(workspace) ? { workspace, recordId: decodeURIComponent(recordParts.join('/') || '') } : { workspace: 'dashboard', recordId: '' };
}

function DesktopNavigation({ active, groups, onChange }: { active: Workspace; groups: Array<{ label: string; items: NavItem[] }>; onChange: (value: Workspace) => void }) {
  return <nav className="desktop-navigation" aria-label="Staff workspaces">{groups.map(group => <section key={group.label}><span>{group.label}</span>{group.items.map(item => <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => onChange(item.id)}><i aria-hidden="true">{item.mark}</i><b>{item.label}</b></button>)}</section>)}</nav>;
}

function MobileNavigation({ active, items, onChange }: { active: Workspace; items: NavItem[]; onChange: (value: Workspace) => void }) {
  const moreActive = !items.filter(item => item.id !== 'more').some(item => item.id === active);
  return <nav className="staff-mobile-nav" aria-label="Primary staff navigation">{items.map(item => { const selected = item.id === 'more' ? moreActive : active === item.id; return <button key={item.id} className={selected ? 'active' : ''} onClick={() => onChange(item.id)}><i aria-hidden="true">{item.mark}</i><span>{item.label}</span></button>; })}</nav>;
}

export function StaffApp() {
  const user = window.__WOA_STAFF_USER__ || {};
  const role = staffRole();
  const allowedWorkspaces = roleWorkspaceAccess[role];
  const initialRoute = useMemo(() => {
    const route = routeFromHash();
    return allowedWorkspaces.has(route.workspace) ? route : { workspace: 'dashboard' as Workspace, recordId: '' };
  }, [allowedWorkspaces]);
  const [workspace, setWorkspace] = useState<Workspace>(initialRoute.workspace);
  const [recordId, setRecordId] = useState(initialRoute.recordId);
  const [returnWorkspace, setReturnWorkspace] = useState<Workspace>('customers');
  const [unread, setUnread] = useState(0);
  const navGroups = useMemo(() => navigationForRole(role), [role]);
  const mobileItems = useMemo(() => mobileNavigationForRole(role), [role]);

  useEffect(() => {
    const onHash = () => {
      const route = routeFromHash();
      const next = allowedWorkspaces.has(route.workspace) ? route : { workspace: 'dashboard' as Workspace, recordId: '' };
      setWorkspace(next.workspace); setRecordId(next.recordId);
      if (next.workspace !== route.workspace) history.replaceState(null, '', '#dashboard');
    };
    onHash(); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, [allowedWorkspaces]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = (force = false) => loadNotifications(controller.signal, force).then(feed => setUnread(Number(feed.unreadCount ?? feed.unread ?? (feed.notifications || feed.notices || feed.items || []).filter(row => !row.read).length))).catch(() => undefined);
    void refresh(); const events = new EventSource('/api/events'); events.addEventListener('platform', () => void refresh(true)); return () => { controller.abort(); events.close(); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const modules: Promise<unknown>[] = [loadFleetModule(), loadMoreModule(), loadDispatchModule(), loadMaintenanceModule(), loadSettingsModule()];
      if (role !== 'mechanic') modules.push(loadCustomersModule(), loadMessagesModule(), loadApplicationsModule(), loadRentalModule());
      if (role === 'owner') modules.push(loadPaymentsModule(), loadAccountingModule());
      if (role === 'manager') modules.push(loadManagerReportsModule());
      void Promise.allSettled(modules);
      prewarmStaffFeeds(role);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [role]);

  const open = (value: string, nextRecordId = '') => {
    const next = value as Workspace;
    if (!workspaceNames.has(next) || !allowedWorkspaces.has(next)) return;
    if (next === 'rental' && workspace !== 'rental') setReturnWorkspace(workspace);
    setWorkspace(next); setRecordId(nextRecordId);
    history.replaceState(null, '', `#${next}${nextRecordId ? `/${encodeURIComponent(nextRecordId)}` : ''}`);
  };
  const openRental = (id: string) => { if (id) open('rental', id); };
  const heading = workspace === 'dashboard' && role === 'mechanic' ? 'Service home' : workspace === 'dashboard' && role === 'manager' ? 'Manager home' : workspaceNames.get(workspace) || 'WheelsonAuto';
  const navigationWorkspace = workspace === 'rental' ? returnWorkspace : workspace;
  const mobileContextBack = workspace !== 'rental' && !mobileItems.some(item => item.id === workspace);
  const initials = useMemo(() => String(user.name || user.username || 'Staff').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(), [user.name, user.username]);

  const roleLabel = role === 'owner' ? 'Operations' : role === 'manager' ? 'Management' : 'Service';

  return <div className={`staff-app-shell role-${role}`}>
    <aside className="staff-rail">
      <button className="staff-brand" onClick={() => open('dashboard')} aria-label="Open dashboard"><strong>Wheels<span>On</span>Auto</strong><small>{roleLabel}</small></button>
      <DesktopNavigation active={navigationWorkspace} groups={navGroups} onChange={open} />
      <footer><button className="staff-profile" onClick={() => open('settings')}><i>{initials}</i><span><strong>{user.name || user.username || 'Staff'}</strong><small>{user.role || 'Staff'}</small></span><b aria-hidden="true">›</b></button></footer>
    </aside>
    <section className="staff-stage">
      <header className="staff-topbar"><div>{mobileContextBack ? <button className="mobile-context-back" onClick={() => open('more')} aria-label="Back to More">‹</button> : null}<span>WheelsonAuto</span><strong>{heading}</strong></div><button className="notification-command" onClick={() => open('dashboard')} aria-label={`${unread} unread notifications`}><span aria-hidden="true">◦</span>{unread ? <b>{unread > 99 ? '99+' : unread}</b> : null}</button></header>
      <section className="staff-app-workspace" aria-live="polite"><Suspense fallback={<div className="workspace-loading"><span /><strong>Opening {heading}</strong></div>}>
        {workspace === 'dashboard' ? role === 'mechanic' ? <ServiceDashboardPage onNavigate={open} /> : role === 'manager' ? <ManagerDashboardPage onNavigate={open} /> : <DashboardPage onNavigate={open} /> : null}
        {workspace === 'fleet' ? <FleetPage role={role} onNavigate={open} onOpenRental={openRental} /> : null}
        {workspace === 'customers' ? <CustomersPage onNavigate={open} onOpenRental={openRental} /> : null}
        {workspace === 'payments' ? <PaymentsPage onOpenRental={openRental} /> : null}
        {workspace === 'applications' ? <ApplicationsPage onOpenRental={openRental} /> : null}
        {workspace === 'messages' ? <MessagesPage /> : null}
        {workspace === 'dispatch' ? <DispatchPage /> : null}
        {workspace === 'maintenance' ? <MaintenancePage /> : null}
        {workspace === 'accounting' ? <AccountingPage /> : null}
        {workspace === 'reports' ? <ManagerReportsPage onNavigate={open} /> : null}
        {workspace === 'systems' ? <SystemsPage /> : null}
        {workspace === 'more' ? <MorePage role={role} onNavigate={open} /> : null}
        {workspace === 'settings' ? <SettingsPage role={role} onNavigate={open} /> : null}
        {workspace === 'rental' ? <RentalFilePage rentalId={recordId} onBack={() => open(returnWorkspace === 'rental' ? 'customers' : returnWorkspace)} /> : null}
      </Suspense></section>
    </section>
    <MobileNavigation active={navigationWorkspace} items={mobileItems} onChange={open} />
  </div>;
}
