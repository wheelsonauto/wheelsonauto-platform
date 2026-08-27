import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calculator,
  CarFront,
  ClipboardCheck,
  Ellipsis,
  Gauge,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  UsersRound,
  type LucideIcon
} from 'lucide-react';
import { loadNotifications, markNotificationsRead, prewarmStaffFeeds } from './api';
import type { NotificationFeed, NotificationRecord } from './types';

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
const AccountingPage = lazy(() => loadAccountingModule().then(module => ({ default: module.AccountingPage })));
const ManagerReportsPage = lazy(() => loadManagerReportsModule().then(module => ({ default: module.ManagerReportsPage })));
const MorePage = lazy(() => loadMoreModule().then(module => ({ default: module.MorePage })));
const SettingsPage = lazy(() => loadSettingsModule().then(module => ({ default: module.SettingsPage })));
const RentalFilePage = lazy(() => loadRentalModule().then(module => ({ default: module.RentalFilePage })));

type Workspace = 'dashboard' | 'fleet' | 'customers' | 'payments' | 'applications' | 'messages' | 'dispatch' | 'maintenance' | 'accounting' | 'reports' | 'systems' | 'more' | 'settings' | 'rental';
type NavItem = { id: Workspace; label: string; icon: LucideIcon };
type StaffRole = 'owner' | 'manager' | 'mechanic';
export type StaffTheme = 'dark' | 'light';

const staffThemeKey = 'wheelsonauto-staff-theme';

function initialStaffTheme(): StaffTheme {
  try { return localStorage.getItem(staffThemeKey) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

function notificationRows(feed: NotificationFeed): NotificationRecord[] {
  return feed.notifications || feed.notices || feed.items || [];
}

function notificationUnread(feed: NotificationFeed, rows = notificationRows(feed)): number {
  return Number(feed.unreadCount ?? feed.unread ?? rows.filter(row => !row.read).length);
}

function notificationTime(row: NotificationRecord): string {
  const value = row.at || row.createdAt || row.date;
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

const ownerNavGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Daily', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'messages', label: 'Messages', icon: MessageSquareText }
  ] },
  { label: 'Business', items: [
    { id: 'fleet', label: 'Fleet', icon: CarFront },
    { id: 'customers', label: 'Customers & payments', icon: UsersRound }
  ] },
  { label: 'Operations', items: [
    { id: 'accounting', label: 'Accounting', icon: Calculator }
  ] }
];

const ownerMobileItems: NavItem[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'fleet', label: 'Fleet', icon: CarFront },
  { id: 'customers', label: 'Customers', icon: UsersRound },
  { id: 'messages', label: 'Messages', icon: MessageSquareText },
  { id: 'more', label: 'More', icon: Ellipsis }
];

const workspaceNames = new Map<Workspace, string>([
  ...ownerNavGroups.flatMap(group => group.items.map(item => [item.id, item.label] as [Workspace, string])),
  ['payments', 'Payments'], ['applications', 'Applications'], ['dispatch', 'Dispatch'], ['maintenance', 'Maintenance'], ['systems', 'Systems'],
  ['reports', 'Reports'], ['more', 'Admin'], ['settings', 'Settings'], ['rental', 'Rental File']
]);

const roleWorkspaceAccess: Record<StaffRole, Set<Workspace>> = {
  owner: new Set(Array.from(workspaceNames.keys()).filter((workspace) => workspace !== 'reports')),
  manager: new Set(['dashboard', 'fleet', 'customers', 'applications', 'messages', 'dispatch', 'reports', 'more', 'settings', 'rental']),
  mechanic: new Set(['dashboard', 'fleet', 'dispatch', 'more', 'settings'])
};

function staffRole(): StaffRole {
  const role = String(window.__WOA_STAFF_USER__?.role || 'owner').toLowerCase();
  return role === 'mechanic' ? 'mechanic' : role === 'manager' ? 'manager' : 'owner';
}

function navigationForRole(role: StaffRole) {
  const allowed = roleWorkspaceAccess[role];
  if (role === 'mechanic') return [
    { label: 'Today', items: [
      { id: 'dashboard', label: 'Service home', icon: LayoutDashboard },
      { id: 'dispatch', label: 'Work queue', icon: ClipboardCheck }
    ] as NavItem[] },
    { label: 'Shop', items: [
      { id: 'fleet', label: 'Fleet & service', icon: CarFront }
    ] as NavItem[] }
  ];
  if (role === 'manager') return [
    { label: 'Daily', items: [
      { id: 'dashboard', label: 'Manager home', icon: LayoutDashboard },
      { id: 'messages', label: 'Messages', icon: MessageSquareText }
    ] as NavItem[] },
    { label: 'Business', items: [
      { id: 'fleet', label: 'Fleet', icon: CarFront },
      { id: 'customers', label: 'Customers', icon: UsersRound }
    ] as NavItem[] },
    { label: 'Operations', items: [
      { id: 'dispatch', label: 'Dispatch', icon: ClipboardCheck },
      { id: 'reports', label: 'Reports', icon: Gauge }
    ] as NavItem[] }
  ];
  return ownerNavGroups.map(group => ({ ...group, items: group.items.filter(item => allowed.has(item.id)) })).filter(group => group.items.length);
}

function mobileNavigationForRole(role: StaffRole): NavItem[] {
  if (role === 'mechanic') return [
    { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
    { id: 'dispatch', label: 'Work', icon: ClipboardCheck },
    { id: 'fleet', label: 'Fleet', icon: CarFront },
    { id: 'more', label: 'More', icon: Ellipsis }
  ];
  return ownerMobileItems;
}

function routeFromHash(): { workspace: Workspace; recordId: string } {
  const [rawWorkspace, ...recordParts] = window.location.hash.replace(/^#/, '').split('/');
  const workspace = rawWorkspace.toLowerCase() as Workspace;
  return workspaceNames.has(workspace) ? { workspace, recordId: decodeURIComponent(recordParts.join('/') || '') } : { workspace: 'dashboard', recordId: '' };
}

function consolidatedRoute(role: StaffRole, route: { workspace: Workspace; recordId: string }) {
  if (route.workspace === 'payments') return { workspace: 'customers' as Workspace, recordId: route.recordId || 'payments' };
  if (route.workspace === 'applications') return { workspace: 'dashboard' as Workspace, recordId: route.recordId || 'applications' };
  if (route.workspace === 'maintenance') return { workspace: 'fleet' as Workspace, recordId: route.recordId || 'service' };
  if (role === 'owner' && (route.workspace === 'dispatch' || route.workspace === 'systems')) return { workspace: 'more' as Workspace, recordId: route.workspace };
  return route;
}

function notificationTarget(row: NotificationRecord): Workspace {
  const hint = [row.type, row.view, row.tab, row.url, row.title].filter(Boolean).join(' ').toLowerCase();
  return /message|inbox/.test(hint) ? 'messages'
    : /payment|charge|card|refund|dispute/.test(hint) ? 'customers'
      : /application|applicant|onboard|pickup/.test(hint) ? 'dashboard'
        : /service|maintenance|inspection/.test(hint) ? 'fleet'
          : /vehicle|fleet|assignment/.test(hint) ? 'fleet'
            : /task|dispatch|claim|issue/.test(hint) ? 'dispatch'
              : 'dashboard';
}

function DesktopNavigation({ active, groups, unreadByWorkspace, onChange }: { active: Workspace; groups: Array<{ label: string; items: NavItem[] }>; unreadByWorkspace: Partial<Record<Workspace, number>>; onChange: (value: Workspace) => void }) {
  return <nav className="desktop-navigation" aria-label="Staff workspaces">{groups.map(group => <section key={group.label}><span>{group.label}</span>{group.items.map(item => { const Icon = item.icon; const unread = Number(unreadByWorkspace[item.id] || 0); return <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => onChange(item.id)}><i aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></i><b>{item.label}</b>{unread ? <u className="nav-unread-dot" aria-label={`${unread} unread`} /> : null}</button>; })}</section>)}</nav>;
}

function MobileNavigation({ active, items, unreadByWorkspace, onChange }: { active: Workspace; items: NavItem[]; unreadByWorkspace: Partial<Record<Workspace, number>>; onChange: (value: Workspace) => void }) {
  const moreActive = !items.filter(item => item.id !== 'more').some(item => item.id === active);
  return <nav className="staff-mobile-nav" aria-label="Primary staff navigation">{items.map(item => { const selected = item.id === 'more' ? moreActive : active === item.id; const Icon = item.icon; const unread = Number(unreadByWorkspace[item.id] || 0); return <button key={item.id} className={selected ? 'active' : ''} onClick={() => onChange(item.id)}><i aria-hidden="true"><Icon size={19} strokeWidth={1.8} />{unread ? <u className="nav-unread-dot" /> : null}</i><span>{item.label}</span></button>; })}</nav>;
}

export function StaffApp() {
  const user = window.__WOA_STAFF_USER__ || {};
  const role = staffRole();
  const allowedWorkspaces = roleWorkspaceAccess[role];
  const initialRoute = useMemo(() => {
    const route = consolidatedRoute(role, routeFromHash());
    return allowedWorkspaces.has(route.workspace) ? route : { workspace: 'dashboard' as Workspace, recordId: '' };
  }, [allowedWorkspaces, role]);
  const [workspace, setWorkspace] = useState<Workspace>(initialRoute.workspace);
  const [recordId, setRecordId] = useState(initialRoute.recordId);
  const [returnWorkspace, setReturnWorkspace] = useState<Workspace>('customers');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [theme, setTheme] = useState<StaffTheme>(initialStaffTheme);
  const notificationCenterRef = useRef<HTMLDivElement>(null);
  const navGroups = useMemo(() => navigationForRole(role), [role]);
  const mobileItems = useMemo(() => mobileNavigationForRole(role), [role]);
  const unreadByWorkspace = useMemo(() => notifications.reduce<Partial<Record<Workspace, number>>>((counts, row) => {
    if (row.read) return counts;
    let target = notificationTarget(row);
    if (role === 'owner' && target === 'dispatch') target = 'more';
    if (!allowedWorkspaces.has(target)) target = 'dashboard';
    counts[target] = Number(counts[target] || 0) + 1;
    return counts;
  }, {}), [allowedWorkspaces, notifications, role]);

  useEffect(() => {
    try { localStorage.setItem(staffThemeKey, theme); } catch { /* Theme still applies for this session. */ }
  }, [theme]);
  useEffect(() => {
    const onHash = () => {
      const route = consolidatedRoute(role, routeFromHash());
      const next = allowedWorkspaces.has(route.workspace) ? route : { workspace: 'dashboard' as Workspace, recordId: '' };
      setWorkspace(next.workspace); setRecordId(next.recordId);
      const normalizedHash = `#${next.workspace}${next.recordId ? `/${encodeURIComponent(next.recordId)}` : ''}`;
      if (window.location.hash !== normalizedHash) history.replaceState(null, '', normalizedHash);
    };
    onHash(); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, [allowedWorkspaces, role]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = (force = false) => loadNotifications(controller.signal, force).then(feed => {
      const rows = notificationRows(feed);
      setNotifications(rows);
      setUnread(notificationUnread(feed, rows));
    }).catch(() => undefined);
    void refresh(); const events = new EventSource('/api/events'); events.addEventListener('platform', () => void refresh(true)); return () => { controller.abort(); events.close(); };
  }, []);
  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!notificationCenterRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const modules: Promise<unknown>[] = [loadFleetModule(), loadMoreModule(), loadDispatchModule(), loadSettingsModule()];
      if (role !== 'mechanic') modules.push(loadCustomersModule(), loadMessagesModule(), loadApplicationsModule(), loadRentalModule());
      if (role === 'owner') modules.push(loadPaymentsModule(), loadAccountingModule());
      if (role === 'manager') modules.push(loadManagerReportsModule());
      void Promise.allSettled(modules);
      prewarmStaffFeeds(role);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [role]);

  const open = (value: string, nextRecordId = '') => {
    const requested = value as Workspace;
    if (!workspaceNames.has(requested)) return;
    const route = consolidatedRoute(role, { workspace: requested, recordId: nextRecordId });
    if (!allowedWorkspaces.has(route.workspace)) return;
    if (route.workspace === 'rental' && workspace !== 'rental') setReturnWorkspace(workspace);
    setWorkspace(route.workspace); setRecordId(route.recordId);
    history.replaceState(null, '', `#${route.workspace}${route.recordId ? `/${encodeURIComponent(route.recordId)}` : ''}`);
  };
  const openRental = (id: string) => { if (id) open('rental', id); };
  const applyNotificationFeed = (feed: NotificationFeed) => {
    const rows = notificationRows(feed);
    setNotifications(rows);
    setUnread(notificationUnread(feed, rows));
  };
  const toggleNotifications = () => {
    const next = !notificationsOpen;
    setNotificationsOpen(next);
    if (!next) return;
    setNotificationsLoading(true);
    void loadNotifications(undefined, true).then(applyNotificationFeed).catch(() => undefined).finally(() => setNotificationsLoading(false));
  };
  const targetForNotification = (row: NotificationRecord): Workspace => {
    const preferred = notificationTarget(row);
    return allowedWorkspaces.has(preferred) ? preferred : 'dashboard';
  };
  const openNotification = (row: NotificationRecord) => {
    setNotifications(current => current.map(item => item.id === row.id ? { ...item, read: true } : item));
    if (!row.read) setUnread(current => Math.max(0, current - 1));
    setNotificationsOpen(false);
    const target = targetForNotification(row);
    const hint = [row.type, row.view, row.tab, row.url, row.title].filter(Boolean).join(' ').toLowerCase();
    const section = target === 'dashboard' && /application|applicant|onboard|pickup/.test(hint) ? 'applications'
      : target === 'customers' && /payment|charge|card|refund|dispute/.test(hint) ? 'payments'
        : '';
    open(target, section);
    if (!row.read) void markNotificationsRead([row.id]).then(applyNotificationFeed).catch(() => undefined);
  };
  const markAllNotificationsRead = () => {
    setNotifications(current => current.map(item => ({ ...item, read: true })));
    setUnread(0);
    void markNotificationsRead([], true).then(applyNotificationFeed).catch(() => undefined);
  };
  const heading = workspace === 'dashboard' && role === 'mechanic' ? 'Service home' : workspace === 'dashboard' && role === 'manager' ? 'Manager home' : workspaceNames.get(workspace) || 'WheelsonAuto';
  const navigationWorkspace = workspace === 'rental' ? returnWorkspace : workspace;
  const mobileContextBack = workspace !== 'rental' && !mobileItems.some(item => item.id === workspace);
  const initials = useMemo(() => String(user.name || user.username || 'Staff').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(), [user.name, user.username]);
  const profileWorkspace: Workspace = role === 'owner' ? 'more' : 'settings';

  const roleLabel = role === 'owner' ? 'Operations' : role === 'manager' ? 'Management' : 'Service';

  return <div className={`staff-app-shell role-${role} theme-${theme}`}>
    <aside className="staff-rail">
      <button className="staff-brand" onClick={() => open('dashboard')} aria-label="Open dashboard"><strong>Wheels<span>On</span>Auto</strong><small>{roleLabel}</small></button>
      <DesktopNavigation active={navigationWorkspace} groups={navGroups} unreadByWorkspace={unreadByWorkspace} onChange={open} />
      <footer><button className="staff-profile" onClick={() => open(profileWorkspace)} aria-label={role === 'owner' ? 'Open owner admin' : 'Open settings'}><i>{initials}</i><span><strong>{user.name || user.username || 'Staff'}</strong><small>{user.role || 'Staff'}</small></span><b aria-hidden="true">›</b></button></footer>
    </aside>
    <section className="staff-stage">
      <header className="staff-topbar"><div>{mobileContextBack ? <button type="button" className="mobile-context-back" onClick={() => open('more')} aria-label="Back to More">‹</button> : null}<span>WheelsonAuto</span><strong>{heading}</strong></div><div className="notification-center" ref={notificationCenterRef}><button type="button" className={`notification-command${notificationsOpen ? ' active' : ''}`} onClick={toggleNotifications} aria-label={`${unread} unread notifications`} aria-expanded={notificationsOpen} aria-controls="staff-notification-panel"><span aria-hidden="true"><Bell size={17} strokeWidth={1.8} /></span>{unread ? <b>{unread > 99 ? '99+' : unread}</b> : null}</button>{notificationsOpen ? <section className="notification-panel" id="staff-notification-panel" aria-label="Notifications"><header><div><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'All caught up'}</span></div>{unread ? <button type="button" onClick={markAllNotificationsRead}>Mark all read</button> : null}</header><div className="notification-list">{notificationsLoading && !notifications.length ? <div className="notification-empty"><strong>Loading updates</strong></div> : notifications.length ? notifications.map(row => <button type="button" key={row.id} className={row.read ? 'read' : ''} onClick={() => openNotification(row)}><i className={`tone-${row.tone || 'blue'}`} aria-hidden="true" /><span><strong>{row.title || 'WheelsonAuto update'}</strong><small>{row.body || row.message || 'Open for details.'}</small>{notificationTime(row) ? <time>{notificationTime(row)}</time> : null}</span>{!row.read ? <b aria-label="Unread" /> : null}</button>) : <div className="notification-empty"><strong>No notifications</strong><span>New activity will appear here automatically.</span></div>}</div></section> : null}</div></header>
      <section className="staff-app-workspace" aria-live="polite"><Suspense fallback={<div className="workspace-loading"><span /><strong>Opening {heading}</strong></div>}>
        {workspace === 'dashboard' ? role === 'mechanic' ? <ServiceDashboardPage onNavigate={open} /> : role === 'manager' ? <ManagerDashboardPage onNavigate={open} onOpenRental={openRental} section={recordId === 'applications' ? 'applications' : 'overview'} onSectionChange={section => open('dashboard', section === 'overview' ? '' : section)} /> : <DashboardPage onNavigate={open} onOpenRental={openRental} section={recordId === 'applications' ? 'applications' : 'overview'} onSectionChange={section => open('dashboard', section === 'overview' ? '' : section)} /> : null}
        {workspace === 'fleet' ? <FleetPage role={role} initialSection={recordId} onNavigate={open} onOpenRental={openRental} /> : null}
        {workspace === 'customers' ? <CustomersPage onNavigate={open} onOpenRental={openRental} /> : null}
        {workspace === 'payments' ? <PaymentsPage onOpenRental={openRental} /> : null}
        {workspace === 'applications' ? <ApplicationsPage onOpenRental={openRental} /> : null}
        {workspace === 'messages' ? <MessagesPage /> : null}
        {workspace === 'dispatch' ? <DispatchPage /> : null}
        {workspace === 'accounting' ? <AccountingPage /> : null}
        {workspace === 'reports' ? <ManagerReportsPage onNavigate={open} /> : null}
        {workspace === 'more' ? <MorePage role={role} theme={theme} onThemeChange={setTheme} onNavigate={open} initialSection={recordId} /> : null}
        {workspace === 'settings' ? <SettingsPage role={role} theme={theme} onThemeChange={setTheme} onNavigate={open} /> : null}
        {workspace === 'rental' ? <RentalFilePage rentalId={recordId} onBack={() => open(returnWorkspace === 'rental' ? 'customers' : returnWorkspace)} /> : null}
      </Suspense></section>
    </section>
    <MobileNavigation active={navigationWorkspace} items={mobileItems} unreadByWorkspace={unreadByWorkspace} onChange={open} />
  </div>;
}
