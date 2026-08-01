import { DispatchPage } from '../dispatch/DispatchPage';
import { SystemsPage } from '../systems/SystemsPage';

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

export function MorePage({ role, onNavigate, initialSection = '' }: { role: 'owner' | 'manager' | 'mechanic'; onNavigate: (workspace: string, recordId?: string) => void; initialSection?: string }) {
  if (role === 'owner' && initialSection === 'dispatch') return <section className="owner-admin-subview"><header className="subview-header"><button type="button" className="back-button" onClick={() => onNavigate('more')}>Back</button><div><span>Owner admin</span><strong>Dispatch</strong></div></header><DispatchPage /></section>;
  if (role === 'owner' && initialSection === 'systems') return <section className="owner-admin-subview"><header className="subview-header"><button type="button" className="back-button" onClick={() => onNavigate('more')}>Back</button><div><span>Owner admin</span><strong>Systems</strong></div></header><SystemsPage /></section>;
  const visibleGroups = role === 'mechanic'
    ? [{ title: 'Account', items: [{ id: 'settings', label: 'Settings', detail: 'Profile, security, and sign out' }] }]
    : role === 'owner'
      ? [{ title: 'Owner tools', items: [
        { id: 'dispatch', label: 'Dispatch', detail: 'Tasks, follow-ups, claims, and ownership' },
        { id: 'systems', label: 'Systems', detail: 'Stripe, Star, email, storage, GPS, and providers' },
        { id: 'settings', label: 'Settings', detail: 'Security, company, appearance, and sign out' }
      ] }]
      : groups.map(group => ({ ...group, items: group.items.filter(item => !['payments', 'accounting', 'systems', 'applications'].includes(item.id)) })).filter(group => group.items.length);
  const openItem = (item: MoreLink) => {
    if (role === 'owner' && (item.id === 'dispatch' || item.id === 'systems')) return onNavigate('more', item.id);
    onNavigate(item.id);
  };
  return <main className="menu-workspace"><header className="page-heading"><div><span>WheelsonAuto staff</span><h1>{role === 'owner' ? 'Owner admin' : 'More'}</h1><p>{role === 'owner' ? 'Sensitive platform controls and dispatch stay in one owner-only workspace.' : 'Deeper tools stay organized without crowding daily navigation.'}</p></div></header>{visibleGroups.map(group => <section className="menu-group" key={group.title}><h2>{group.title}</h2>{group.items.map(item => <button className="menu-row" key={item.id} onClick={() => openItem(item)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></button>)}</section>)}</main>;
}
