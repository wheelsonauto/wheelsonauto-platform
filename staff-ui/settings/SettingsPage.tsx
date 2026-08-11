import type { StaffTheme } from '../StaffApp';

export function SettingsPage({ role, theme, onThemeChange, onNavigate, embedded = false }: { role: 'owner' | 'manager' | 'mechanic'; theme: StaffTheme; onThemeChange: (theme: StaffTheme) => void; onNavigate: (workspace: string) => void; embedded?: boolean }) {
  const user = window.__WOA_STAFF_USER__ || {};
  const accessDetail = role === 'owner'
    ? 'Full company operations and protected owner controls'
    : role === 'manager'
      ? 'Customers, applications, fleet, messages, service, and operations reporting'
      : 'Vehicles, work queue, inspections, and maintenance';
  return <main className={`settings-workspace${embedded ? ' embedded-settings' : ''}`}>{!embedded ? <header className="page-heading"><div><span>Account and platform</span><h1>Settings</h1><p>Security and system controls stay out of daily work screens.</p></div></header> : null}
    <section className="settings-section"><h2>Account</h2><div className="settings-rows"><div><span><strong>{user.name || user.username || 'Staff'}</strong><small>{user.role || 'Staff'}{user.companyName ? ` | ${user.companyName}` : ''}</small></span></div><a href="/forgot"><span><strong>Reset password</strong><small>Use secure email recovery for this account</small></span><b>›</b></a><a href="/logout"><span><strong>Sign out</strong><small>End this staff session</small></span><b>›</b></a></div></section>
    <section className="settings-section"><h2>Appearance</h2><div className="settings-rows"><label className="theme-toggle-row"><span><strong>Light appearance</strong><small>{theme === 'light' ? 'White workspace with charcoal text' : 'Dark charcoal workspace'}</small></span><input type="checkbox" checked={theme === 'light'} onChange={event => onThemeChange(event.target.checked ? 'light' : 'dark')} aria-label="Use light appearance" /><i aria-hidden="true"><b /></i></label></div></section>
    <section className="settings-section"><h2>Access</h2><div className="settings-rows"><div><span><strong>{role === 'owner' ? 'Owner workspace' : role === 'manager' ? 'Manager workspace' : 'Mechanic workspace'}</strong><small>{accessDetail}</small></span></div>{role === 'owner' ? <button onClick={() => onNavigate('systems')}><span><strong>Connected systems</strong><small>Provider status and live-test evidence</small></span><b>›</b></button> : null}</div></section>
    <section className="settings-section"><h2>Version</h2><div className="settings-rows"><div><span><strong>WheelsonAuto platform</strong><small>Release {window.__WOA_RELEASE__ || 'development'} | Live protected workspace</small></span></div></div></section>
  </main>;
}
