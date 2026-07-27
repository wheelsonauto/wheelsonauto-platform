import { FormEvent, useEffect, useMemo, useState } from 'react';
import { completeRentalReturn, loadRentalDetail } from '../api';
import type { RentalDetail, RentalLinkedRecord } from '../types';
import { dateTime, money, shortDate, statusTone } from '../ui';

type Tab = 'overview' | 'money' | 'activity' | 'evidence';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function recordDate(record: RentalLinkedRecord) {
  return record.paidAt || record.signedAt || record.completedAt || record.updatedAt || record.createdAt || record.transactionDate || record.date || '';
}

function recordTitle(record: RentalLinkedRecord) {
  if (record.title || record.type || record.subject || record.issue || record.originalName) return record.title || record.type || record.subject || record.issue || record.originalName || 'Connected record';
  if (record.body) return `${/inbound|received/i.test(record.direction || record.status || '') ? 'Customer' : 'WheelsonAuto'} message`;
  if (record.nextRun || record.nextDue || record.frequency) return `${record.frequency || 'Weekly'} payment schedule`;
  if (typeof record.amount === 'number') return `${record.provider || record.method || record.source || 'Account'} payment`;
  return record.name || record.customer || 'Connected record';
}

function recordDetail(record: RentalLinkedRecord) {
  return record.body || record.notes || [record.vehicle, record.provider || record.method || record.source].filter(Boolean).join(' | ') || record.status || 'Saved in this Rental File';
}

function LinkedList({ rows, empty, evidence }: { rows: RentalLinkedRecord[]; empty: string; evidence?: 'document' | 'agreement' }) {
  if (!rows.length) return <div className="empty-state compact">{empty}</div>;
  return <div className="rental-linked-list">{rows.map(record => {
    const href = evidence === 'document' ? `/api/onboarding/documents/${encodeURIComponent(record.id)}` : evidence === 'agreement' ? `/api/onboarding/contracts/${encodeURIComponent(record.id)}` : '';
    return <article key={record.id}><span className={`activity-mark ${statusTone(record.status)}`} /><div><strong>{recordTitle(record)}</strong><p>{recordDetail(record)}</p><time>{dateTime(recordDate(record))}</time></div>{typeof record.amount === 'number' ? <b>{money(record.amount)}</b> : href ? <a href={href} target="_blank" rel="noreferrer">Open</a> : <em>{record.status || ''}</em>}</article>;
  })}</div>;
}

export function RentalFilePage({ rentalId, onBack }: { rentalId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<RentalDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [returnDraft, setReturnDraft] = useState({ endDate: today(), endingMileage: '', vehicleStatus: 'Prep' as 'Ready' | 'Prep' | 'Service', reason: '' });

  const refresh = async (signal?: AbortSignal) => {
    if (!rentalId) return;
    try { setDetail(await loadRentalDetail(rentalId, signal)); setError(''); }
    catch (requestError) { if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', () => void refresh());
    return () => { controller.abort(); events.close(); };
  }, [rentalId]);

  const file = detail?.rentalFile;
  const records = detail?.records || {};
  const rows = (name: string) => records[name] || [];
  const counts = useMemo(() => ({
    money: rows('payments').length + rows('paymentRequests').length + rows('recurringPayments').length + rows('refundRequests').length,
    activity: rows('messages').length + rows('maintenance').length + rows('claims').length + rows('trackerEvents').length,
    evidence: rows('documents').length + rows('eSignatures').length + rows('contracts').length + rows('pickupAppointments').length
  }), [detail]);
  const active = !!file && /active|rented|picked up/i.test(file.status || '') && !file.endDate;

  const submitReturn = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !confirmed || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const endingMileage = Number(returnDraft.endingMileage);
      await completeRentalReturn(file.id, { endDate: returnDraft.endDate, endingMileage, vehicleStatus: returnDraft.vehicleStatus, reason: returnDraft.reason });
      setNotice('Return completed. Autopay stopped, customer moved to history, and the vehicle moved to the selected fleet status.');
      setReturnOpen(false); setConfirmed(false); await refresh();
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setWorking(false); }
  };

  return <main className="rental-file-workspace">
    <header className="rental-file-header"><button className="detail-back visible" onClick={onBack}>Back</button><div><span>Canonical Rental File</span><h1>{file?.customerName || (loading ? 'Opening rental...' : 'Rental File')}</h1><p>{file ? `${file.vehicleName || 'Vehicle'}${file.plate ? ` | ${file.plate}` : ''}` : 'Customer, vehicle, money, work, and proof in one immutable record.'}</p></div>{file ? <em className={`status-chip ${statusTone(file.status)}`}>{file.status || 'Recorded'}</em> : null}</header>
    {error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
    {loading ? <div className="workspace-loading"><span /><strong>Opening Rental File</strong></div> : null}
    {!loading && !file ? <div className="detail-empty"><strong>Rental File not found</strong><span>This record may have been moved or is outside your company access.</span></div> : null}
    {file ? <>
      <section className="rental-vitals"><div><span>Weekly payment</span><strong>{money(file.weeklyAmount)}</strong><small>{file.paymentProvider || 'Provider not set'}</small></div><div><span>Next charge</span><strong>{shortDate(file.nextChargeDate)}</strong><small>{file.paymentDay || 'Day not set'}</small></div><div><span>Started</span><strong>{shortDate(file.startDate)}</strong><small>{file.startingMileage ? `${file.startingMileage.toLocaleString()} mi` : 'Mileage not recorded'}</small></div><div><span>Vehicle</span><strong>{file.plate || 'No tag'}</strong><small>{file.vin || 'VIN not linked'}</small></div></section>
      <nav className="rental-tabs" aria-label="Rental File sections">{(['overview', 'money', 'activity', 'evidence'] as Tab[]).map(key => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span>{key[0].toUpperCase() + key.slice(1)}</span>{key !== 'overview' ? <b>{counts[key]}</b> : null}</button>)}</nav>
      <section className="rental-tab-body">
        {tab === 'overview' ? <div className="rental-overview-grid"><section className="rental-section"><header><span>Assignment</span><h2>Customer and vehicle</h2></header><dl className="detail-list"><div><dt>Customer</dt><dd>{file.customerName || 'Not linked'}</dd></div><div><dt>Customer ID</dt><dd>{file.customerId || 'Not linked'}</dd></div><div><dt>Vehicle</dt><dd>{file.vehicleName || 'Not linked'}</dd></div><div><dt>VIN</dt><dd>{file.vin || 'Not linked'}</dd></div><div><dt>Tag / plate</dt><dd>{file.plate || 'Not linked'}</dd></div><div><dt>Tracker</dt><dd>{file.tracker || 'Not linked'}</dd></div></dl></section><section className="rental-section"><header><span>Billing truth</span><h2>Pickup-anchored schedule</h2></header><dl className="detail-list"><div><dt>Pickup date</dt><dd>{shortDate(file.actualPickupDate || file.startDate)}</dd></div><div><dt>Autopay anchor</dt><dd>{shortDate(file.autopayAnchorDate || file.startDate)}</dd></div><div><dt>Payment day</dt><dd>{file.paymentDay || 'Not set'}</dd></div><div><dt>Next charge</dt><dd>{shortDate(file.nextChargeDate)}</dd></div><div><dt>Provider</dt><dd>{file.paymentProvider || 'Not set'}</dd></div><div><dt>Rental ID</dt><dd>{file.id}</dd></div></dl></section>{active ? <section className="rental-section return-section"><header><span>Sensitive action</span><h2>Complete physical return</h2></header>{!returnOpen ? <><p>Use this only after the vehicle is physically back. It ends this Rental File, stops its recurring schedule, moves the customer to history, and updates fleet status.</p><button className="danger-command" onClick={() => setReturnOpen(true)}>Start return</button></> : <form onSubmit={submitReturn}><div className="form-grid"><label>Return date<input type="date" value={returnDraft.endDate} min={file.startDate} onChange={event => setReturnDraft({ ...returnDraft, endDate: event.target.value })} required /></label><label>Ending mileage<input type="number" min={file.startingMileage || 0} step="1" value={returnDraft.endingMileage} onChange={event => setReturnDraft({ ...returnDraft, endingMileage: event.target.value })} required /></label><label>Vehicle goes to<select value={returnDraft.vehicleStatus} onChange={event => setReturnDraft({ ...returnDraft, vehicleStatus: event.target.value as 'Ready' | 'Prep' | 'Service' })}><option>Prep</option><option>Ready</option><option>Service</option></select></label><label className="span-2">Return reason and condition<textarea rows={4} value={returnDraft.reason} onChange={event => setReturnDraft({ ...returnDraft, reason: event.target.value })} required /></label></div><label className="confirmation-line"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm the physical vehicle is back at WheelsonAuto.</label><div className="return-actions"><button type="button" className="text-command" onClick={() => { setReturnOpen(false); setConfirmed(false); }}>Cancel</button><button className="danger-command" disabled={!confirmed || working}>{working ? 'Completing...' : 'Complete return'}</button></div></form>}</section> : <section className="rental-section"><header><span>Return record</span><h2>Rental completed</h2></header><dl className="detail-list"><div><dt>End date</dt><dd>{shortDate(file.endDate)}</dd></div><div><dt>Ending mileage</dt><dd>{file.endingMileage ? `${file.endingMileage.toLocaleString()} mi` : 'Not recorded'}</dd></div><div><dt>Reason</dt><dd>{file.endReason || 'Not recorded'}</dd></div></dl></section>}</div> : null}
        {tab === 'money' ? <div className="rental-column"><section className="rental-section"><header><span>Schedule</span><h2>Recurring payment</h2></header><LinkedList rows={rows('recurringPayments')} empty="No recurring schedule is linked." /></section><section className="rental-section"><header><span>Ledger</span><h2>Transactions and requests</h2></header><LinkedList rows={[...rows('payments'), ...rows('paymentRequests'), ...rows('refundRequests')].sort((a, b) => Date.parse(recordDate(b)) - Date.parse(recordDate(a)))} empty="No payment records are linked yet." /></section></div> : null}
        {tab === 'activity' ? <div className="rental-column"><section className="rental-section"><header><span>Conversation</span><h2>Messages</h2></header><LinkedList rows={rows('messages')} empty="No messages are linked to this rental." /></section><section className="rental-section"><header><span>Vehicle work</span><h2>Service and inspections</h2></header><LinkedList rows={rows('maintenance')} empty="No service records are linked." /></section><section className="rental-section"><header><span>Recovery</span><h2>Claims, tolls, and issues</h2></header><LinkedList rows={rows('claims')} empty="No claims, tolls, or issues are linked." /></section></div> : null}
        {tab === 'evidence' ? <div className="rental-column"><section className="rental-section"><header><span>Signed proof</span><h2>Agreements</h2></header><LinkedList rows={rows('eSignatures')} empty="No signed agreement is linked." evidence="agreement" /></section><section className="rental-section"><header><span>Private file</span><h2>Documents</h2></header><LinkedList rows={rows('documents')} empty="No private documents are linked." evidence="document" /></section><section className="rental-section"><header><span>Lifecycle proof</span><h2>Application and pickup</h2></header><LinkedList rows={[...rows('applications'), ...rows('pickupAppointments'), ...rows('contracts')]} empty="No onboarding or pickup proof is linked." /></section></div> : null}
      </section>
    </> : null}
  </main>;
}
