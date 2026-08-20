import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Paperclip } from 'lucide-react';
import { loadCustomerMessages, loadCustomerNotifications, loadCustomerPortal, markCustomerNotificationsRead, sendCustomerMessage, sendCustomerMessageAttachment, uploadCustomerDocument } from './api';
import type { CustomerNotification, CustomerPortal, PortalRecord } from './types';
import { useSwipeTabs } from '../staff-ui/useSwipeTabs';

type Tab = 'home' | 'messages' | 'payments' | 'vehicle' | 'settings';
type SettingsSection = 'profile' | 'documents' | 'feedback' | 'security';

const tabs: Array<{ id: Tab; label: string; mark: string }> = [
  { id: 'home', label: 'Home', mark: 'H' },
  { id: 'messages', label: 'Messages', mark: 'M' },
  { id: 'payments', label: 'Payments', mark: '$' },
  { id: 'vehicle', label: 'Vehicle', mark: 'V' },
  { id: 'settings', label: 'Settings', mark: 'S' }
];
const tabIds: readonly Tab[] = tabs.map(tab => tab.id);

const emptyPortal: CustomerPortal = {
  account: {}, summary: {}, application: {}, applications: [], onboardingSessions: [], availableVehicles: [], customer: {}, contract: {}, recurring: {}, vehicle: {}, vehicles: [], payments: [], maintenance: [], claims: [], messages: [], documents: [], paymentRequests: [], cardSetupRequests: [], generatedAt: ''
};

function routeFromHash(): Tab {
  const value = window.location.hash.replace(/^#/, '').replace(/^portal-/, '').split('/')[0].toLowerCase();
  return tabs.some(tab => tab.id === value) ? value as Tab : 'home';
}

function customerRouteHref(value: unknown) {
  const href = String(value || '').trim();
  const match = href.match(/^\/customer#(?:portal-)?(home|overview|messages|payments|vehicle|service|documents|issues|settings)$/i);
  if (!match) return href || '#home';
  const section = match[1].toLowerCase();
  if (section === 'overview') return '#home';
  if (['service', 'issues'].includes(section)) return '#vehicle';
  if (section === 'documents') return '#settings';
  return `#${section}`;
}

function money(value: unknown) {
  const number = Number(value || 0);
  return number.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function shortDate(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return 'Not set';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: parsed.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

function wholeNumber(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Not recorded';
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString('en-US') : raw;
}

function localDateInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function recordTime(row: PortalRecord) {
  return Date.parse(row.updatedAt || row.createdAt || row.submittedAt || row.paidAt || row.date || '') || 0;
}

function messageTime(row: PortalRecord) {
  return Date.parse(row.createdAt || row.date || row.updatedAt || '') || 0;
}

function rowStatusTone(value: unknown) {
  const text = String(value || '').toLowerCase();
  if (/paid|active|ready|complete|approved|verified|current|delivered/.test(text)) return 'good';
  if (/failed|declined|overdue|rejected|removed|cancelled|missing/.test(text)) return 'bad';
  if (/pending|review|due|open|scheduled|requested|waiting/.test(text)) return 'warn';
  return 'neutral';
}

function summaryValue(portal: CustomerPortal, key: string, fallback: unknown = '') {
  return portal.summary && portal.summary[key] != null ? portal.summary[key] : fallback;
}

function firstName(portal: CustomerPortal) {
  return String(portal.account.name || portal.account.customer || portal.customer.name || 'Customer').trim().split(/\s+/)[0] || 'Customer';
}

function vehicleName(portal: CustomerPortal) {
  return String(summaryValue(portal, 'vehicle', portal.vehicle.title || portal.vehicle.vehicle || portal.vehicle.name || 'Vehicle not linked'));
}

function openClaims(portal: CustomerPortal) {
  return portal.claims.filter(row => !/paid|closed|resolved|cancelled/i.test(String(row.status || '')));
}

function nextService(portal: CustomerPortal) {
  return portal.maintenance.filter(row => !/complete|closed|fixed|done/i.test(String(row.status || ''))).sort((a, b) => recordTime(a) - recordTime(b))[0];
}

function PortalRow({ row, trailing }: { row: PortalRecord; trailing?: string }) {
  const title = row.title || row.type || row.vehicle || row.subject || row.method || row.status || 'Account item';
  const detailDate = row.date || row.createdAt || row.due || row.nextDue;
  const customerMessage = row.stripeCardSetupCustomerMessage || row.cardSetupCustomerMessage || row.customerMessage;
  const detail = [row.status, detailDate ? shortDate(detailDate) : '', customerMessage || row.notes || row.issue].filter(Boolean).join(' - ');
  const link = row.portalDownloadUrl || row.portalUrl || row.url || '';
  const content = <><span><strong>{title}</strong><small>{detail || 'Open for details'}</small></span><b>{trailing || (row.amount != null ? money(row.amount) : '>')}</b></>;
  return link ? <a className="customer-row" href={link}>{content}</a> : <div className="customer-row">{content}</div>;
}

function Empty({ children }: { children: string }) {
  return <div className="customer-empty">{children}</div>;
}

function HomePage({ portal, onNavigate }: { portal: CustomerPortal; onNavigate: (tab: Tab) => void }) {
  const recurring = portal.recurring || {};
  const weekly = Number(recurring.amount || recurring.weeklyAmount || summaryValue(portal, 'amount', 0));
  const balance = Number(summaryValue(portal, 'balance', summaryValue(portal, 'weeklyRemaining', weekly)) || 0);
  const claims = openClaims(portal);
  const claimsTotal = claims.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const service = nextService(portal);
  const attention = [
    ...portal.paymentRequests.map(row => ({ ...row, title: row.type || 'Payment request' })),
    ...portal.cardSetupRequests.map(row => ({ ...row, title: 'Card update needed' })),
    ...claims.slice(0, 3)
  ].slice(0, 5);
  return <main className="customer-page home-page">
    <header className="customer-page-heading"><div><span>My account</span><h1>Good to see you, {firstName(portal)}</h1><p>{vehicleName(portal)}</p></div><i className={`customer-state ${rowStatusTone(recurring.status)}`}>{recurring.status || 'Account open'}</i></header>
    <section className="customer-metrics">
      <button onClick={() => onNavigate('payments')}><span>Next payment</span><strong>{money(balance)}</strong><small>{shortDate(recurring.nextRun || summaryValue(portal, 'nextRun'))}</small></button>
      <button onClick={() => onNavigate('payments')}><span>Tolls and fees</span><strong>{money(claimsTotal)}</strong><small>{claims.length} open item{claims.length === 1 ? '' : 's'}</small></button>
      <button onClick={() => onNavigate('vehicle')}><span>Service</span><strong>{service ? shortDate(service.due || service.nextDue) : 'Current'}</strong><small>{service?.type || service?.issue || 'No open request'}</small></button>
      <button onClick={() => onNavigate('messages')}><span>Messages</span><strong>{portal.messages.length}</strong><small>WheelsonAuto conversation</small></button>
    </section>
    <section className="customer-home-grid">
      <article className="customer-surface vehicle-glance"><header><div><span>My vehicle</span><h2>{vehicleName(portal)}</h2></div><button className="quiet-command" onClick={() => onNavigate('vehicle')}>Details</button></header><dl className="customer-facts"><div><dt>VIN</dt><dd>{portal.vehicle.vin || summaryValue(portal, 'vin', 'Not linked') as string}</dd></div><div><dt>Tag</dt><dd>{portal.vehicle.plate || portal.vehicle.stock || summaryValue(portal, 'tag', 'Not linked') as string}</dd></div><div><dt>Mileage</dt><dd>{wholeNumber(portal.vehicle.mileage || portal.vehicle.currentMileage)}</dd></div><div><dt>Status</dt><dd>{portal.vehicle.status || 'Not set'}</dd></div></dl></article>
      <article className="customer-surface"><header><div><span>Needs attention</span><h2>Account items</h2></div></header>{attention.length ? <div className="customer-list">{attention.map((row, index) => <PortalRow key={row.id || index} row={row} />)}</div> : <Empty>Your account is caught up.</Empty>}</article>
    </section>
  </main>;
}

function MessagesPage({ portal, onPortal, onBack }: { portal: CustomerPortal; onPortal: Dispatch<SetStateAction<CustomerPortal>>; onBack: () => void }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const rows = useMemo(() => portal.messages.slice().sort((a, b) => messageTime(a) - messageTime(b)), [portal.messages]);
  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight }); }, [rows.length]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text && !attachment || sending) return;
    const deliveryId = `customer-next-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: PortalRecord = {
      id: `sending-${deliveryId}`,
      body: text,
      direction: 'Inbound',
      channel: 'Customer portal',
      status: 'Sending',
      createdAt: new Date().toISOString(),
      attachment: attachment ? { documentId: '', name: attachment.name, contentType: attachment.type, size: attachment.size } : undefined
    };
    const selectedAttachment = attachment;
    setSending(true); setError(''); setBody(''); setAttachment(null);
	    onPortal(current => ({ ...current, messages: [optimistic, ...current.messages.filter(row => row.id !== optimistic.id)] }));
	    try {
	      const result = selectedAttachment
          ? await sendCustomerMessageAttachment(text, deliveryId, await filePayload(selectedAttachment))
          : await sendCustomerMessage(text, deliveryId);
	      onPortal(current => ({ ...current, messages: [result.message, ...current.messages.filter(row => row.id !== optimistic.id && row.id !== result.message.id)] }));
	    } catch (reason) {
	      onPortal(current => ({ ...current, messages: current.messages.filter(row => row.id !== optimistic.id) }));
      setBody(current => current || text);
      setAttachment(current => current || selectedAttachment);
      setError(reason instanceof Error ? reason.message : 'Message could not be sent.');
    } finally { setSending(false); }
  };
  return <main className="customer-message-page">
    <header><button className="customer-message-back" onClick={onBack} aria-label="Back to account">&lt;</button><div className="customer-avatar">WOA</div><div><strong>WheelsonAuto</strong><span>Office conversation</span></div><i>Secure</i></header>
    <div className="customer-message-history" ref={historyRef}>{rows.length ? rows.map((row, index) => {
      const mine = /inbound|customer action/i.test(String(row.direction || ''));
      const file = row.attachment;
      return <article key={row.id || index} className={mine ? 'mine' : 'office'}><p>{row.body || row.subject || 'Message update'}</p>{file ? <a className="customer-message-attachment" href={file.customerUrl || `/customer/documents/${encodeURIComponent(file.documentId)}`} target="_blank" rel="noreferrer">{file.contentType.startsWith('image/') && file.documentId ? <img src={file.customerUrl || `/customer/documents/${encodeURIComponent(file.documentId)}`} alt={file.name} /> : null}<span>{file.name}</span></a> : null}<footer>{mine ? 'You' : 'WheelsonAuto'} - {shortDate(row.createdAt || row.date)}{row.status ? ` - ${row.status}` : ''}</footer></article>;
    }) : <Empty>Start a conversation with WheelsonAuto.</Empty>}</div>
    <form className="customer-composer" onSubmit={submit}>{error ? <span className="composer-error">{error}</span> : null}{attachment ? <span className="selected-attachment">{attachment.name}<button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">x</button></span> : null}<div><input ref={fileInputRef} type="file" accept="image/jpeg,image/png,application/pdf" hidden onChange={event => setAttachment(event.target.files?.[0] || null)} /><button className="attachment-command" type="button" title="Attach photo or PDF" aria-label="Attach photo or PDF" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button><textarea value={body} onChange={event => setBody(event.target.value)} placeholder="Message WheelsonAuto" maxLength={1200} rows={1} /><button disabled={(!body.trim() && !attachment) || sending} aria-label="Send message">{sending ? '...' : 'Send'}</button></div></form>
  </main>;
}

function PaymentsPage({ portal }: { portal: CustomerPortal }) {
  const recurring = portal.recurring || {};
  const weekly = Number(recurring.amount || recurring.weeklyAmount || summaryValue(portal, 'amount', 0));
  const open = [...portal.paymentRequests, ...portal.cardSetupRequests];
  const provider = String(recurring.paymentProvider || recurring.provider || 'stripe').toLowerCase();
  const providerLabel = provider === 'clover' ? 'Clover' : 'Stripe';
  return <main className="customer-page">
    <header className="customer-page-heading"><div><span>Payments</span><h1>Balance and billing</h1><p>Pay, update your card, or move an upcoming payment date.</p></div><i className={`customer-state ${rowStatusTone(recurring.status)}`}>{recurring.status || 'Not linked'}</i></header>
    <section className="customer-metrics three"><div><span>Weekly amount</span><strong>{money(weekly)}</strong><small>{recurring.frequency || 'Weekly'}</small></div><div><span>Next charge</span><strong>{shortDate(recurring.nextRun)}</strong><small>{recurring.chargeTime || 'Time not set'}</small></div><div><span>Saved card</span><strong>{recurring.cardLast4 ? `...${recurring.cardLast4}` : 'Setup'}</strong><small>{recurring.paymentProvider || recurring.provider || 'Stripe'}</small></div></section>
    <section className="customer-content-grid">
      <article className="customer-surface"><header><div><span>Make a payment</span><h2>Pay now or ahead</h2></div></header><form className="customer-form" method="post" action="/customer/account-payment"><label>Amount<input name="amount" type="number" min="1" max="5000" step="0.01" defaultValue={weekly || ''} required /></label><label>Apply to<select name="allocation" defaultValue="current_week"><option value="current_week">Current weekly payment</option><option value="pay_ahead">Pay ahead</option><option value="past_due">Past-due balance</option><option value="tolls_fees">Tolls, violations, or fees</option></select></label><button className="primary-command">Continue to secure payment</button></form>
        <div className="section-divider" /><header><div><span>Move payment</span><h2>Change the due date</h2></div></header><form className="customer-form" method="post" action="/customer/payment-date-change"><label>New date<input name="targetDate" type="date" required /></label><p>The date can move forward up to seven days. The exact fee is your weekly amount divided by seven for each day.</p><button className="secondary-command">Review date-change fee</button></form></article>
      <article className="customer-surface"><header><div><span>Saved payment method</span><h2>Card on file</h2></div></header><form className="customer-payment-method" method="post" action="/customer/card-change"><input type="hidden" name="paymentProvider" value={provider} /><span><strong>{recurring.cardLast4 ? `${providerLabel} ending in ${recurring.cardLast4}` : `${providerLabel} secure card setup`}</strong><small>WheelsonAuto never sees or stores your full card number.</small></span><button className="secondary-command">Change card</button></form><div className="section-divider" /><header><div><span>Open actions</span><h2>Payment and card links</h2></div></header>{open.length ? <div className="customer-list">{open.map((row, index) => <PortalRow key={row.id || index} row={row} />)}</div> : <Empty>No open payment or card links.</Empty>}<div className="section-divider" /><header><div><span>History</span><h2>Recent payments</h2></div></header>{portal.payments.length ? <div className="customer-list">{portal.payments.slice(0, 12).map((row, index) => <PortalRow key={row.id || index} row={row} trailing={money(row.amount)} />)}</div> : <Empty>No payment history is available yet.</Empty>}<details className="customer-disclosure payment-support-actions"><summary>Receipts and other payment actions</summary><form className="customer-form" method="post" action="/customer/receipt-request"><label className="full">Payment date, amount, or note<input name="paymentHint" maxLength={160} placeholder="Example: July 23, $250" /></label><button className="secondary-command">Request receipt</button></form><div className="section-divider" /><form className="customer-form" method="post" action="/customer/statement-request"><label>Document<select name="requestType" defaultValue="Account statement"><option>Account statement</option><option>Payoff balance</option><option>Payment history</option><option>Balance letter</option></select></label><label>Note<input name="note" maxLength={200} placeholder="What do you need it for?" /></label><button className="secondary-command">Request document</button></form><div className="section-divider" /><form className="customer-form" method="post" action="/customer/paid-outside"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Method<select name="method" defaultValue="Cash"><option>Cash</option><option>Zelle</option><option>Cash App</option><option>Money order</option><option>Clover terminal</option><option>Other</option></select></label><label>Date<input name="paidDate" type="date" defaultValue={localDateInputValue()} required /></label><label>Proof link<input name="proofUrl" type="url" maxLength={500} placeholder="Optional receipt or screenshot link" /></label><label className="full">Proof or note<textarea name="note" maxLength={1200} required /></label><button className="secondary-command">Send for verification</button></form></details></article>
    </section>
  </main>;
}

function VehiclePage({ portal }: { portal: CustomerPortal }) {
  const vehicle = portal.vehicle || {};
  const service = portal.maintenance.slice().sort((a, b) => recordTime(b) - recordTime(a));
  return <main className="customer-page">
    <header className="customer-page-heading"><div><span>Vehicle</span><h1>{vehicleName(portal)}</h1><p>{[vehicle.vin, vehicle.plate || vehicle.stock].filter(Boolean).join(' - ') || 'Vehicle identity will appear after assignment.'}</p></div><i className={`customer-state ${rowStatusTone(vehicle.status)}`}>{vehicle.status || 'Not assigned'}</i></header>
    <section className="customer-content-grid">
      <article className="customer-surface"><header><div><span>Current vehicle</span><h2>Identity and service</h2></div></header><dl className="customer-facts"><div><dt>VIN</dt><dd>{vehicle.vin || 'Not linked'}</dd></div><div><dt>Tag</dt><dd>{vehicle.plate || vehicle.stock || 'Not linked'}</dd></div><div><dt>Tracker</dt><dd>{vehicle.tracker || 'Office managed'}</dd></div><div><dt>Mileage</dt><dd>{vehicle.mileage || vehicle.currentMileage || 'Not recorded'}</dd></div></dl><div className="section-divider" /><header><div><span>Need service?</span><h2>Request an appointment</h2></div></header><form className="customer-form" method="post" action="/customer/service-request"><label>Service needed<select name="type"><option>Monthly inspection / oil change</option><option>Repair issue</option><option>Tire / brake concern</option><option>Warning light</option><option>Other service request</option></select></label><label>Preferred date<input name="preferredDate" type="date" /></label><label className="full">What is happening?<textarea name="notes" maxLength={1200} required /></label><button className="primary-command">Request service</button></form></article>
      <article className="customer-surface"><header><div><span>Maintenance history</span><h2>Service record</h2></div></header>{service.length ? <div className="customer-list">{service.map((row, index) => <PortalRow key={row.id || index} row={row} />)}</div> : <Empty>No service records are linked yet.</Empty>}<div className="section-divider" /><details className="customer-disclosure"><summary>Report a toll, ticket, damage, or other issue</summary><form className="customer-form" method="post" action="/customer/issue-report"><label>Issue type<select name="type"><option>Toll / E-ZPass notice</option><option>Ticket / violation</option><option>Damage</option><option>Insurance / claim</option><option>Tracker issue</option><option>Other issue</option></select></label><label>Incident date<input name="incidentDate" type="date" /></label><label>Amount shown<input name="amount" type="number" min="0" step="0.01" /></label><label>Proof link<input name="proofUrl" maxLength={500} /></label><label className="full">What happened?<textarea name="notes" maxLength={1200} required /></label><button className="primary-command">Send for review</button></form></details></article>
    </section>
    <section className="customer-wide-surface"><header><div><span>Applications and swaps</span><h2>My requests</h2></div></header><div className="vehicle-request-grid"><div>{portal.applications.length ? <div className="customer-list">{portal.applications.map((row, index) => <PortalRow key={row.id || index} row={row} />)}</div> : <Empty>No applications are open.</Empty>}</div><div className="available-vehicles">{portal.availableVehicles.length ? portal.availableVehicles.slice(0, 6).map(row => <a key={row.id} href={`/apply/${encodeURIComponent(String(row.slug || row.id || ''))}`}><span>{row.imageUrl ? <img src={row.imageUrl} alt="" /> : 'WOA'}</span><strong>{row.title || 'Available vehicle'}</strong><small>{money(row.weeklyPayment)}/week</small></a>) : <Empty>No vehicles are online right now.</Empty>}</div></div>{portal.availableVehicles.length ? <details className="customer-disclosure"><summary>Request a vehicle swap</summary><form className="customer-form" method="post" action="/customer/swap-request"><label className="full">Vehicle<select name="onlineVehicleId" required><option value="">Choose an available vehicle</option>{portal.availableVehicles.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label className="confirmation full"><input type="checkbox" name="termResetAccepted" value="yes" required /><span>I understand an approved swap starts a new 19-month term.</span></label><label className="full">Note<textarea name="notes" maxLength={600} /></label><button className="primary-command">Send swap request</button></form></details> : null}</section>
  </main>;
}

function filePayload(file: File) {
  return new Promise<{ name: string; type: string; size: number; dataUrl: string }>((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) return reject(new Error('The file must be 5 MB or smaller.'));
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) return reject(new Error('Choose a JPG, PNG, or PDF.'));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result || '') });
    reader.onerror = () => reject(new Error('The selected document could not be read.'));
    reader.readAsDataURL(file);
  });
}

function SettingsPage({ portal, onRefresh }: { portal: CustomerPortal; onRefresh: () => Promise<void> }) {
  const [section, setSection] = useState<SettingsSection | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const active = section || 'profile';
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setUploading(true); setError(''); setNotice('');
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('documentFile');
    try {
      if (!(file instanceof File) || !file.size) throw new Error('Choose a JPG, PNG, or PDF.');
      await uploadCustomerDocument({ type: String(values.get('type') || ''), provider: String(values.get('provider') || ''), reference: String(values.get('reference') || ''), expires: String(values.get('expires') || ''), notes: String(values.get('notes') || ''), file: await filePayload(file) });
      form.reset(); setNotice('Document uploaded securely for staff review.'); await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Document could not be uploaded.'); }
    finally { setUploading(false); }
  };
  const menu: Array<{ id: SettingsSection; title: string; detail: string }> = [
    { id: 'profile', title: 'Profile and login', detail: 'Phone, email, and username' },
    { id: 'documents', title: 'Documents', detail: 'Insurance, license, and receipts' },
    { id: 'feedback', title: 'Bug or suggestion', detail: 'Send feedback to WheelsonAuto' },
    { id: 'security', title: 'Security and privacy', detail: 'Password, policies, and sign out' }
  ];
  return <main className={`customer-page settings-page ${section ? 'settings-open' : ''}`}>
    <header className="customer-page-heading"><div><span>Settings</span><h1>Account and privacy</h1><p>Open one area at a time.</p></div></header>
    <div className="settings-layout"><nav className="settings-menu">{menu.map(item => <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>&gt;</b></button>)}</nav><section className="settings-detail"><button className="settings-back" onClick={() => setSection(null)}>&lt; Settings</button>
      {notice ? <div className="form-notice">{notice}</div> : null}{error ? <div className="form-notice error">{error}</div> : null}
      {active === 'profile' ? <article><header><div><span>Personal information</span><h2>Profile and login</h2></div></header><form className="customer-form" method="post" action="/customer/profile"><label>Legal name<input value={portal.customer.name || portal.account.name || ''} disabled /></label><label>Phone<input name="phone" type="tel" defaultValue={portal.account.phone || portal.customer.phone || ''} required /></label><label>Email<input name="email" type="email" defaultValue={portal.account.email || portal.customer.email || ''} required /></label><label>Username<input name="username" defaultValue={portal.account.username || portal.account.email || ''} required /></label><label className="full">Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label><button className="primary-command">Save account changes</button></form></article> : null}
      {active === 'documents' ? <article><header><div><span>Private files</span><h2>Documents</h2></div></header><form className="customer-form" onSubmit={upload}><label>Document type<select name="type"><option>Insurance proof</option><option>Driver license</option><option>Registration</option><option>Other document</option></select></label><label>Provider<input name="provider" maxLength={120} /></label><label className="full">Secure file<input name="documentFile" type="file" accept="image/jpeg,image/png,application/pdf" required /></label><label>Reference<input name="reference" maxLength={160} /></label><label>Expiration date<input name="expires" type="date" /></label><label className="full">Note<textarea name="notes" maxLength={600} /></label><button className="primary-command" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload securely'}</button></form><div className="section-divider" />{portal.documents.length ? <div className="customer-list">{portal.documents.map((row, index) => <PortalRow key={row.id || index} row={row} />)}</div> : <Empty>No customer-visible documents are available.</Empty>}</article> : null}
      {active === 'feedback' ? <article><header><div><span>Help improve the app</span><h2>Bug or suggestion</h2></div></header><form className="customer-form" method="post" action="/customer/feedback"><label>Type<select name="category"><option>Report a bug</option><option>Suggest an improvement</option><option>Account help</option></select></label><label>Page<select name="page"><option>Home</option><option>Messages</option><option>Payments</option><option>Vehicle</option><option>Settings</option></select></label><label className="full">Details<textarea name="details" maxLength={1600} required /></label><button className="primary-command">Send to WheelsonAuto</button></form></article> : null}
      {active === 'security' ? <article><header><div><span>Security</span><h2>Password and privacy</h2></div></header><div className="settings-actions"><a href="/customer/forgot">Reset password</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms</a><a href="/cancellation">Cancellation policy</a><a className="danger" href="/customer/logout">Log out</a></div></article> : null}
    </section></div>
  </main>;
}

function NotificationCenter({ rows, unread, onRead }: { rows: CustomerNotification[]; unread: number; onRead: (rows: CustomerNotification[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = () => { const next = !open; setOpen(next); if (next) onRead(rows.filter(row => !row.read)); };
  return <div className="customer-notifications"><button onClick={toggle} aria-label={`${unread} unread notifications`}>N{unread ? <b>{unread > 99 ? '99+' : unread}</b> : null}</button>{open ? <aside><header><strong>Notifications</strong><button onClick={() => setOpen(false)}>Close</button></header>{rows.length ? rows.slice(0, 12).map(row => <a key={row.id} href={customerRouteHref(row.url)}><i className={row.tone || ''} /><span><strong>{row.title || 'Account update'}</strong><small>{row.body || shortDate(row.at)}</small></span></a>) : <Empty>No new notifications.</Empty>}</aside> : null}</div>;
}

export function CustomerApp() {
  const bootstrap = (window as typeof window & { __WOA_CUSTOMER_ACCOUNT__?: { name?: string; assistedByOwner?: boolean; assistedByOwnerName?: string } }).__WOA_CUSTOMER_ACCOUNT__ || {};
  const [tab, setTab] = useState<Tab>(routeFromHash());
  const [portal, setPortal] = useState<CustomerPortal>(emptyPortal);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = (next: Tab) => { setTab(next); history.replaceState(null, '', `#${next}`); };
  const tabSwipe = useSwipeTabs(tabIds, tab, navigate, () => window.matchMedia('(max-width: 720px)').matches);
  const refresh = async (signal?: AbortSignal) => {
    try { const next = await loadCustomerPortal(signal); setPortal(next); setError(''); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'Account could not be refreshed.'); }
    finally { setLoading(false); }
  };
	  const refreshNotifications = async (signal?: AbortSignal) => {
    try { const feed = await loadCustomerNotifications(signal); setNotifications(feed.notifications || []); setUnread(Number(feed.unreadCount || 0)); } catch { /* next event retries */ }
	  };
	  const refreshMessages = async (signal?: AbortSignal) => {
	    try {
	      const feed = await loadCustomerMessages(signal);
	      setPortal(current => {
	        const feedIds = new Set((feed.messages || []).map(row => String(row.id || '')));
	        const optimistic = current.messages.filter(row => String(row.id || '').startsWith('sending-') && !feedIds.has(String(row.id || '')));
	        const retained = current.messages.filter(row => !feedIds.has(String(row.id || '')) && !String(row.id || '').startsWith('sending-'));
	        return { ...current, messages: [...optimistic, ...(feed.messages || []), ...retained] };
	      });
	    } catch { /* the next live event retries the feed */ }
	  };
  useEffect(() => {
    const onHash = () => setTab(routeFromHash());
    onHash(); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !['https:', 'http:'].includes(window.location.protocol)) return;
    void navigator.serviceWorker.register('/service-worker.js', { scope: '/customer', updateViaCache: 'none' }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal); void refreshNotifications(controller.signal);
    const events = new EventSource('/api/customer/events');
    let refreshTimer = 0;
    let refreshInFlight = false;
    let refreshQueued = false;
	    const runLiveRefresh = async (messagesOnly = false) => {
	      if (refreshInFlight) { refreshQueued = true; return; }
	      refreshInFlight = true;
	      await (messagesOnly ? Promise.all([refreshMessages(), refreshNotifications()]) : Promise.all([refresh(), refreshNotifications()]));
	      refreshInFlight = false;
	      if (refreshQueued) { refreshQueued = false; scheduleLiveRefresh(); }
	    };
	    const scheduleLiveRefresh = (messagesOnly = false) => {
	      window.clearTimeout(refreshTimer);
	      refreshTimer = window.setTimeout(() => { void runLiveRefresh(messagesOnly); }, 80);
	    };
	    events.addEventListener('platform', (event: MessageEvent) => {
	      try {
	        const payload = JSON.parse(event.data || '{}');
	        const topics = Array.isArray(payload.topics) ? payload.topics : [];
	        scheduleLiveRefresh(topics.length > 0 && topics.every((topic: string) => topic === 'messages'));
	      } catch { scheduleLiveRefresh(); }
	    });
    return () => { controller.abort(); events.close(); window.clearTimeout(refreshTimer); };
  }, []);
  const markRead = async (rows: CustomerNotification[]) => {
    const ids = rows.map(row => row.id); if (!ids.length) return;
    setNotifications(current => current.map(row => ids.includes(row.id) ? { ...row, read: true } : row)); setUnread(current => Math.max(0, current - ids.length));
    try { const feed = await markCustomerNotificationsRead(ids); setNotifications(feed.notifications); setUnread(feed.unreadCount); } catch { void refreshNotifications(); }
  };
  if (loading) return <main className="customer-loading"><span /><strong>Opening your WheelsonAuto account</strong></main>;
  return <div className={`customer-next-shell tab-${tab}`}>
    <aside className="customer-rail"><button className="customer-brand" onClick={() => navigate('home')}><strong>Wheels<span>On</span>Auto</strong><small>My account</small></button><nav>{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><i>{item.mark}</i><span>{item.label}</span>{item.id === 'messages' && portal.messages.length ? <b>{portal.messages.length}</b> : null}</button>)}</nav><footer><a href="/customer/logout">Log out</a></footer></aside>
    <section className={`customer-stage${bootstrap.assistedByOwner ? ' assisted' : ''}`}><header className="customer-topbar"><div><small>WheelsonAuto</small><strong>{tabs.find(item => item.id === tab)?.label}</strong></div><span>{firstName(portal)}</span><NotificationCenter rows={notifications} unread={unread} onRead={markRead} /></header>{bootstrap.assistedByOwner ? <aside className="customer-assistance-banner" role="status"><span><strong>Owner assistance mode</strong><small>{bootstrap.assistedByOwnerName || 'Owner admin'} is viewing {bootstrap.name || 'this customer'} for support. This audited session expires in 15 minutes.</small></span><a href="/customer/assist/end">Return to admin</a></aside> : null}{error ? <div className="customer-global-error">{error}<button onClick={() => void refresh()}>Retry</button></div> : null}<section className="customer-workspace customer-swipe-zone" {...tabSwipe}>
      {tab === 'home' ? <HomePage portal={portal} onNavigate={navigate} /> : null}
      {tab === 'messages' ? <MessagesPage portal={portal} onPortal={setPortal} onBack={() => navigate('home')} /> : null}
      {tab === 'payments' ? <PaymentsPage portal={portal} /> : null}
      {tab === 'vehicle' ? <VehiclePage portal={portal} /> : null}
      {tab === 'settings' ? <SettingsPage portal={portal} onRefresh={() => refresh()} /> : null}
    </section></section>
    <nav className="customer-bottom-nav">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><i>{item.mark}</i><span>{item.label}</span></button>)}</nav>
  </div>;
}
