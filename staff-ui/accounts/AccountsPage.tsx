import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Building2, KeyRound, LogIn, Plus, UserRoundCog, UsersRound } from 'lucide-react';
import { assistCustomerAccount, loadAccountDirectory, saveCustomerAccount, saveOrganization, saveStaffAccount } from '../api';
import type { AccountDirectory, CustomerAccountRecord, OrganizationRecord, StaffAccountRecord } from '../types';
import { wordsMatch } from '../ui';

type AccountTab = 'staff' | 'customers' | 'companies';
type EditableAccount = Partial<StaffAccountRecord & CustomerAccountRecord & OrganizationRecord> & { id: string; password?: string };

const tabs: readonly AccountTab[] = ['staff', 'customers', 'companies'];
const labels: Record<AccountTab, string> = { staff: 'Staff logins', customers: 'Customer accounts', companies: 'Companies' };

function emptyRecord(tab: AccountTab, directory: AccountDirectory | null): EditableAccount {
  if (tab === 'staff') return { id: '', name: '', username: '', role: 'Manager', organizationId: directory?.organizations[0]?.id || 'org-wheelsonauto', email: '', phone: '', status: 'Active', password: '' };
  if (tab === 'customers') return { id: '', name: '', customer: '', customerId: '', username: '', organizationId: 'org-wheelsonauto', email: '', phone: '', status: 'Active', password: '' };
  return { id: '', name: '', legalBusinessName: '', type: 'Store / location', status: 'Active', primaryAdmin: '', businessEmail: '', businessPhone: '', serviceStreet: '', serviceCity: '', serviceState: 'NJ', servicePostalCode: '', notes: '' };
}

function recordName(tab: AccountTab, row: EditableAccount) {
  return tab === 'customers' ? String((row as CustomerAccountRecord).customer || row.name || row.username || 'Customer account') : String(row.name || 'Unnamed account');
}

export function AccountsPage() {
  const [directory, setDirectory] = useState<AccountDirectory | null>(null);
  const [tab, setTab] = useState<AccountTab>('staff');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<EditableAccount | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try { setDirectory(await loadAccountDirectory(signal, force)); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
  };

  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, []);

  const rows = useMemo<EditableAccount[]>(() => {
    const source = tab === 'staff' ? directory?.staffAccounts : tab === 'customers' ? directory?.customerAccounts : directory?.organizations;
    return (source || []).map(row => row as EditableAccount).filter(row => wordsMatch(query, [recordName(tab, row), row.username, row.email, row.phone, row.status, row.role, row.type]));
  }, [directory, query, tab]);

  const chooseTab = (value: AccountTab) => { setTab(value); setSelectedId(''); setDraft(null); setQuery(''); setError(''); setNotice(''); };
  const openRecord = (row: EditableAccount) => { setSelectedId(row.id); setDraft({ ...row, password: '' }); setError(''); setNotice(''); };
  const openNew = () => { setSelectedId(''); setDraft(emptyRecord(tab, directory)); setError(''); setNotice(''); };
  const closeDetail = () => { setSelectedId(''); setDraft(null); setError(''); setNotice(''); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (tab === 'staff') await saveStaffAccount(draft as Partial<StaffAccountRecord> & { password?: string });
      if (tab === 'customers') await saveCustomerAccount(draft as Partial<CustomerAccountRecord> & { password?: string });
      if (tab === 'companies') await saveOrganization(draft as Partial<OrganizationRecord>);
      await refresh(undefined, true);
      setNotice(selectedId ? `${labels[tab].replace(/s$/, '')} updated.` : `${labels[tab].replace(/s$/, '')} created.`);
      setDraft(null); setSelectedId('');
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setSaving(false); }
  };

  const assist = async () => {
    if (!draft?.id || saving) return;
    setSaving(true); setError('');
    try { const result = await assistCustomerAccount(draft.id); window.location.assign(result.url); }
    catch (requestError) { setError((requestError as Error).message); setSaving(false); }
  };

  const selectCustomer = (customerId: string) => {
    if (!draft) return;
    const customer = directory?.customers.find(row => row.id === customerId);
    setDraft({ ...draft, customerId, customer: customer?.name || '', name: customer?.name || '', email: customer?.email || draft.email, phone: customer?.phone || draft.phone, organizationId: customer?.organizationId || draft.organizationId });
  };

  return <main className={`operations-workspace resource-workspace account-directory ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index">
      <header className="workspace-title"><div><span>Owner access control</span><h1>Accounts</h1></div><button type="button" className="primary-command compact" onClick={openNew}><Plus size={15} /> Add</button></header>
      <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Account types">{tabs.map(value => <button type="button" role="tab" aria-selected={tab === value} key={value} className={tab === value ? 'active' : ''} onClick={() => chooseTab(value)}><span>{labels[value]}</span><strong>{value === 'staff' ? directory?.staffAccounts.length || 0 : value === 'customers' ? directory?.customerAccounts.length || 0 : directory?.organizations.length || 0}</strong></button>)}</div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${labels[tab].toLowerCase()}`} /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}{notice && !draft ? <div className="inline-alert">{notice}</div> : null}
      <div className="record-list">{!directory ? <div className="empty-state">Loading accounts...</div> : null}{directory && !rows.length ? <div className="empty-state">No matching accounts.</div> : null}{rows.map(row => <button type="button" key={row.id} className={row.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => openRecord(row)}><span className="status-line neutral" /><span className="record-main"><strong>{recordName(tab, row)}</strong><span>{row.username || row.email || row.type || 'Account details'}</span></span><span className="record-side"><b>{row.status || 'Active'}</b><time>{tab === 'staff' ? row.role : tab === 'customers' ? (row as CustomerAccountRecord).loginReady ? 'Login ready' : 'Password needed' : row.type}</time></span></button>)}</div>
    </section>
    <section className="operations-detail">{!draft ? <div className="detail-empty"><strong>Choose an account</strong><span>Staff, customer portal, and company access stay in this owner-only directory.</span></div> : <form onSubmit={submit} className="static-detail">
      <header className="detail-header"><button type="button" className="detail-back" onClick={closeDetail}>Back</button><div><span>{draft.id ? 'Edit account' : 'New account'}</span><h2>{recordName(tab, draft)}</h2></div>{tab === 'staff' ? <UserRoundCog size={19} /> : tab === 'customers' ? <UsersRound size={19} /> : <Building2 size={19} />}</header>
      <div className="detail-scroll">{error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
        {tab === 'staff' ? <div className="form-grid"><label>Name<input required value={draft.name || ''} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>Username<input required value={draft.username || ''} onChange={event => setDraft({ ...draft, username: event.target.value })} /></label><label>Role<select value={draft.role || 'Manager'} onChange={event => setDraft({ ...draft, role: event.target.value })}><option>Manager</option><option>Mechanic</option></select></label><label>Company<select value={draft.organizationId || ''} onChange={event => setDraft({ ...draft, organizationId: event.target.value })}>{directory?.organizations.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label>Email<input type="email" value={draft.email || ''} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label><label>Phone<input value={draft.phone || ''} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label>Status<select value={draft.status || 'Active'} onChange={event => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Disabled</option></select></label><label>{draft.id ? 'New password (optional)' : 'Password'}<input type="password" required={!draft.id} value={draft.password || ''} onChange={event => setDraft({ ...draft, password: event.target.value })} /></label></div> : null}
        {tab === 'customers' ? <><div className="form-grid"><label className="span-2">Customer file<select required value={(draft as CustomerAccountRecord).customerId || ''} onChange={event => selectCustomer(event.target.value)}><option value="">Choose exact customer</option>{directory?.customers.map(row => <option key={row.id} value={row.id}>{row.name || row.email || row.phone}</option>)}</select></label><label>Username / login<input required value={draft.username || ''} onChange={event => setDraft({ ...draft, username: event.target.value })} /></label><label>Status<select value={draft.status || 'Active'} onChange={event => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Disabled</option></select></label><label>Email<input type="email" value={draft.email || ''} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label><label>Phone<input value={draft.phone || ''} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label className="span-2">{draft.id ? 'Reset password (optional)' : 'Password'}<input type="password" required={!draft.id} value={draft.password || ''} onChange={event => setDraft({ ...draft, password: event.target.value })} /></label></div>{draft.id ? <div className="context-actions"><button type="button" className="secondary-command" onClick={assist} disabled={saving}><LogIn size={15} /> Assist in customer portal</button></div> : null}</> : null}
        {tab === 'companies' ? <div className="form-grid"><label>Display name<input required value={draft.name || ''} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>Legal business name<input value={(draft as OrganizationRecord).legalBusinessName || ''} onChange={event => setDraft({ ...draft, legalBusinessName: event.target.value })} /></label><label>Type<select value={draft.type || 'Store / location'} onChange={event => setDraft({ ...draft, type: event.target.value })}><option>Store / location</option><option>Company</option><option>Franchise</option></select></label><label>Status<select value={draft.status || 'Active'} onChange={event => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Disabled</option></select></label><label>Primary admin<input value={(draft as OrganizationRecord).primaryAdmin || ''} onChange={event => setDraft({ ...draft, primaryAdmin: event.target.value })} /></label><label>Email<input type="email" value={(draft as OrganizationRecord).businessEmail || ''} onChange={event => setDraft({ ...draft, businessEmail: event.target.value })} /></label><label>Phone<input value={(draft as OrganizationRecord).businessPhone || ''} onChange={event => setDraft({ ...draft, businessPhone: event.target.value })} /></label><label>Street<input value={(draft as OrganizationRecord).serviceStreet || ''} onChange={event => setDraft({ ...draft, serviceStreet: event.target.value })} /></label><label>City<input value={(draft as OrganizationRecord).serviceCity || ''} onChange={event => setDraft({ ...draft, serviceCity: event.target.value })} /></label><label>State<input value={(draft as OrganizationRecord).serviceState || ''} onChange={event => setDraft({ ...draft, serviceState: event.target.value })} /></label><label>Postal code<input value={(draft as OrganizationRecord).servicePostalCode || ''} onChange={event => setDraft({ ...draft, servicePostalCode: event.target.value })} /></label><label className="span-2">Notes<textarea rows={4} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label></div> : null}
        <div className="account-security-note"><KeyRound size={17} /><span><strong>Credentials stay private.</strong><small>Passwords are replaced with a salted hash and are never shown back in this directory.</small></span></div>
      </div>
      <footer className="detail-actions"><button className="primary-command" disabled={saving}>{saving ? 'Saving...' : draft.id ? 'Save account' : 'Create account'}</button></footer>
    </form>}</section>
  </main>;
}
