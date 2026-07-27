type MoreLink = { id: string; label: string; detail: string };

const groups: Array<{ title: string; items: MoreLink[] }> = [
  { title: 'Operations', items: [
    { id: 'applications', label: 'Applications', detail: 'Review, onboarding, and paid pickup queue' },
    { id: 'dispatch', label: 'Dispatch', detail: 'Tasks, follow-ups, and ownership' },
    { id: 'maintenance', label: 'Maintenance', detail: 'Service jobs, inspections, and history' }
  ] },
  { title: 'Business', items: [
    { id: 'payments', label: 'Payments', detail: 'Transactions and payment exceptions' },
    { id: 'accounting', label: 'Accounting', detail: 'Monthly totals, reconciliation, and exports' },
    { id: 'reports', label: 'Reports', detail: 'Customer, fleet, application, and service health' },
    { id: 'systems', label: 'Systems', detail: 'Stripe, Star, email, storage, GPS, and providers' }
  ] },
  { title: 'Account', items: [
    { id: 'settings', label: 'Settings', detail: 'Profile, security, company, and sign out' }
  ] }
];

export function MorePage({ role, onNavigate }: { role: 'owner' | 'manager' | 'mechanic'; onNavigate: (workspace: string) => void }) {
  const visibleGroups = role === 'mechanic'
    ? [{ title: 'Account', items: [{ id: 'settings', label: 'Settings', detail: 'Profile, security, and sign out' }] }]
    : groups.map(group => ({ ...group, items: group.items.filter(item => role === 'owner' ? item.id !== 'reports' : !['payments', 'accounting', 'systems'].includes(item.id)) })).filter(group => group.items.length);
  return <main className="menu-workspace"><header className="page-heading"><div><span>WheelsonAuto staff</span><h1>More</h1><p>Deeper tools stay organized without crowding daily navigation.</p></div></header>{visibleGroups.map(group => <section className="menu-group" key={group.title}><h2>{group.title}</h2>{group.items.map(item => <button className="menu-row" key={item.id} onClick={() => onNavigate(item.id)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></button>)}</section>)}</main>;
}
