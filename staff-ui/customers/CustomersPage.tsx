import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CarFront,
  CircleDollarSign,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  MessageSquareText,
  Plus,
  Send,
  Trash2,
  WalletCards
} from 'lucide-react';
import {
  assignCustomerVehicle,
  chargeSavedCard,
  createAutopay,
  createPaymentLink,
  createReplacementCardSetup,
  deleteCardSetup,
  loadAutopay,
  loadCustomers,
  loadPayments,
  loadVehicles,
  recordManualPaymentResult,
  removeAutopay,
  sendMessage,
  updateAutopay,
  updateCustomer
} from '../api';
import type { CustomerRecord, PaymentRecord, RecurringPaymentRecord, VehicleRecord } from '../types';
import { dateTime, money, shortDate, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { useViewedRecords } from '../useViewedRecords';

type Filter = 'active' | 'setup' | 'history';
type WorkspaceView = 'customers' | 'payments';
type DetailTab = 'customer' | 'payments';
type PaymentAction = 'new' | 'charge' | 'result' | 'link' | 'card' | 'edit' | 'remove' | 'delete' | null;

const filters: readonly Filter[] = ['active', 'setup', 'history'];
const workspaceViews: readonly WorkspaceView[] = ['customers', 'payments'];
const detailTabs: readonly DetailTab[] = ['customer', 'payments'];

type ActionDraft = {
  amount: string;
  frequency: string;
  nextRun: string;
  chargeTime: string;
  status: string;
  result: string;
  method: string;
  reason: string;
  note: string;
  provider: 'stripe' | 'clover';
  vehicleId: string;
  autoChargeEnabled: boolean;
  emailLink: boolean;
  confirmed: boolean;
  operationId: string;
};

function normalized(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isHistory(customer: CustomerRecord) {
  return /history|ended|removed|inactive|returned/i.test([customer.status, customer.stage].join(' '));
}

function isSetup(customer: CustomerRecord) {
  return !isHistory(customer) && /setup|pending|application|onboarding/i.test([customer.status, customer.stage].join(' '));
}

function sameCustomer(row: PaymentRecord | RecurringPaymentRecord, customer: CustomerRecord) {
  if (row.customerId && String(row.customerId) === String(customer.id)) return true;
  if (row.customerAccountId && customer.customerAccountId && String(row.customerAccountId) === String(customer.customerAccountId)) return true;
  return !!(row.customer && customer.name && normalized(row.customer) === normalized(customer.name));
}

function vehicleTitle(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vin || 'Unnamed vehicle';
}

function dateInput(value?: string) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function operationId() {
  return `staff-payment-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function actionDraft(row: RecurringPaymentRecord | null, customer: CustomerRecord, action: PaymentAction): ActionDraft {
  const provider = /clover/i.test(String(row?.paymentProvider || row?.provider || '')) ? 'clover' : 'stripe';
  return {
    amount: String(row?.amount || customer.amount || ''),
    frequency: row?.frequency || 'Weekly',
    nextRun: dateInput(row?.nextRun),
    chargeTime: row?.chargeTime || '18:00',
    status: row?.status || 'Active',
    result: 'Paid',
    method: 'Paid outside app',
    reason: action === 'link' ? 'Payment needs attention' : action === 'card' ? 'Change card on file' : '',
    note: '',
    provider,
    vehicleId: row?.vehicleId || customer.vehicleId || '',
    autoChargeEnabled: !!row?.autoChargeEnabled,
    emailLink: !!customer.email,
    confirmed: false,
    operationId: operationId()
  };
}

export function CustomersPage({ onNavigate, onOpenRental, initialView = 'customers' }: { onNavigate: (workspace: string, recordId?: string) => void; onOpenRental: (rentalId: string) => void; initialView?: WorkspaceView }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [autopay, setAutopay] = useState<RecurringPaymentRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [selectedId, setSelectedId] = useState('');
  const [selectedAutopayId, setSelectedAutopayId] = useState('');
  const [draft, setDraft] = useState<CustomerRecord | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>(initialView === 'payments' ? 'payments' : 'customer');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentAction, setPaymentAction] = useState<PaymentAction>(null);
  const [paymentDraft, setPaymentDraft] = useState<ActionDraft | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [assignmentVehicleId, setAssignmentVehicleId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('Customer vehicle assignment updated by staff.');
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [customerFeed, paymentFeed, autopayFeed, vehicleFeed] = await Promise.all([
        loadCustomers(signal, force), loadPayments(signal, force), loadAutopay(signal, force), loadVehicles(signal, force)
      ]);
      setCustomers(customerFeed.records || []);
      setPayments(paymentFeed.records || []);
      setAutopay(autopayFeed.records || []);
      setVehicles(vehicleFeed.records || []);
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally { setLoading(false); }
  };

  useEffect(() => { setView(initialView); if (initialView === 'payments') setDetailTab('payments'); }, [initialView]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).some((topic: string) => ['customers', 'payments', 'assignments'].includes(topic))) void refresh(undefined, true);
      } catch { /* A later event repairs the view. */ }
    });
    return () => { controller.abort(); events.close(); };
  }, []);
  useEffect(() => {
    const customer = customers.find(row => row.id === selectedId);
    if (!customer) return;
    setDraft({ ...customer });
    setAssignmentVehicleId(customer.vehicleId || '');
  }, [selectedId, customers]);

  const viewed = useViewedRecords('customers', customers, !loading);
  const paymentCountFor = (customer: CustomerRecord) => payments.filter(row => sameCustomer(row, customer)).length + autopay.filter(row => sameCustomer(row, customer)).length;
  const paymentAttentionFor = (customer: CustomerRecord) => autopay.filter(row => sameCustomer(row, customer) && /failed|declined|not found|review|paused|setup|waiting/i.test([row.status, row.paymentSetup].join(' '))).length;
  const visible = useMemo(() => customers.filter(customer => {
    if (filter === 'history' && !isHistory(customer)) return false;
    if (filter === 'setup' && !isSetup(customer)) return false;
    if (filter === 'active' && (isHistory(customer) || isSetup(customer))) return false;
    return wordsMatch(query, [customer.name, customer.phone, customer.email, customer.vehicle, customer.vin, customer.licensePlate, customer.status]);
  }).sort((a, b) => view === 'payments'
    ? paymentAttentionFor(b) - paymentAttentionFor(a) || paymentCountFor(b) - paymentCountFor(a) || String(a.name || '').localeCompare(String(b.name || ''))
    : String(a.name || '').localeCompare(String(b.name || ''))), [customers, payments, autopay, query, filter, view]);

  const counts = {
    active: customers.filter(row => !isHistory(row) && !isSetup(row)).length,
    setup: customers.filter(isSetup).length,
    history: customers.filter(isHistory).length
  };
  const selectedCustomerPayments = useMemo(() => draft ? payments.filter(row => sameCustomer(row, draft)).sort((a, b) => (Date.parse(b.createdAt || b.date || '') || 0) - (Date.parse(a.createdAt || a.date || '') || 0)) : [], [draft, payments]);
  const selectedCustomerAutopay = useMemo(() => draft ? autopay.filter(row => sameCustomer(row, draft)).sort((a, b) => Number(/failed|declined|not found|review|paused/i.test(b.status || '')) - Number(/failed|declined|not found|review|paused/i.test(a.status || '')) || String(a.nextRun || '').localeCompare(String(b.nextRun || ''))) : [], [draft, autopay]);
  const selectedSchedule = selectedCustomerAutopay.find(row => row.id === selectedAutopayId) || selectedCustomerAutopay[0] || null;

  useEffect(() => {
    if (!selectedCustomerAutopay.length) { setSelectedAutopayId(''); return; }
    if (!selectedCustomerAutopay.some(row => row.id === selectedAutopayId)) setSelectedAutopayId(selectedCustomerAutopay[0].id);
  }, [selectedCustomerAutopay, selectedAutopayId]);

  const closeDetail = () => {
    setDraft(null); setSelectedId(''); setPaymentAction(null); setPaymentDraft(null); setGeneratedUrl(''); setError(''); setNotice('');
  };
  const openCustomer = (customer: CustomerRecord) => {
    viewed.markViewed(customer.id);
    setSelectedId(customer.id); setDraft({ ...customer }); setAssignmentVehicleId(customer.vehicleId || ''); setDetailTab(view === 'payments' ? 'payments' : 'customer'); setPaymentAction(null); setPaymentDraft(null); setError(''); setNotice('');
  };
  const beginAction = (action: PaymentAction) => {
    if (!draft) return;
    setPaymentAction(action); setPaymentDraft(actionDraft(selectedSchedule, draft, action)); setGeneratedUrl(''); setError(''); setNotice('');
  };

  const submitCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await updateCustomer(draft.id, { expectedUpdatedAt: draft.updatedAt, phone: draft.phone, email: draft.email, address: draft.address, city: draft.city, state: draft.state, postalCode: draft.postalCode, notes: draft.notes });
      await refresh(undefined, true); setDraft(result.record); setNotice('Customer contact details updated across exact linked records.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const saveAssignment = async () => {
    if (!draft || !assignmentVehicleId || !assignmentConfirmed || working) { setError('Choose the exact vehicle and confirm the assignment or swap.'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await assignCustomerVehicle(draft.id, { vehicleId: assignmentVehicleId, expectedUpdatedAt: draft.updatedAt, reason: assignmentReason });
      await refresh(undefined, true); setDraft(result.customer); setAssignmentConfirmed(false); setNotice(result.unchanged ? 'That exact vehicle is already assigned.' : `Vehicle assignment updated across ${result.propagated.length} linked records.`);
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setWorking(false); }
  };

  const copyGeneratedUrl = async () => {
    try { await navigator.clipboard.writeText(generatedUrl); setNotice('Secure link copied.'); }
    catch { setError('The browser could not copy the link. Open it and copy the address.'); }
  };

  const runPaymentAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !paymentDraft || !paymentAction || working) return;
    if (!paymentDraft.confirmed) { setError('Confirm this exact customer and action before continuing.'); return; }
    const amount = Number(paymentDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid amount.'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      if (paymentAction === 'new') {
        const vehicle = vehicles.find(row => row.id === paymentDraft.vehicleId);
        if (!vehicle || !paymentDraft.nextRun) throw new Error('Choose the exact vehicle and first charge date.');
        const tag = vehicle.plate || vehicle.stock || vehicle.tempTag || '';
        const result = await createAutopay({ customer: draft.name || '', phone: draft.phone, email: draft.email, vehicle: vehicleTitle(vehicle), vehicleId: vehicle.id, vin: vehicle.vin, licensePlate: tag, plate: tag, tempTag: vehicle.tempTag, tracker: vehicle.tracker, amount, frequency: paymentDraft.frequency, nextRun: paymentDraft.nextRun, chargeTime: paymentDraft.chargeTime, notes: paymentDraft.note || 'Stripe setup created from the connected customer file.' });
        setGeneratedUrl(result.setupLink.url); setNotice('Stripe setup link created. No charge was made.');
      } else {
        if (!selectedSchedule) throw new Error('Choose the exact recurring plan first.');
        if (paymentAction === 'charge') {
          const result = await chargeSavedCard({ recurringPaymentId: selectedSchedule.id, amount, nextRun: paymentDraft.nextRun, note: paymentDraft.note });
          setNotice(`${money(result.payment.amount)} ${result.payment.status || 'payment'} recorded for ${result.payment.customer || draft.name}.`);
        }
        if (paymentAction === 'result') {
          const result = await recordManualPaymentResult({ recurringPaymentId: selectedSchedule.id, expectedUpdatedAt: selectedSchedule.updatedAt, operationId: paymentDraft.operationId, result: paymentDraft.result, amount, method: paymentDraft.method, nextRun: paymentDraft.nextRun, notes: paymentDraft.note });
          setNotice(result.duplicate ? 'That exact payment result was already saved.' : `${paymentDraft.result} saved to the payment history.`);
        }
        if (paymentAction === 'link') {
          const result = await createPaymentLink({ recurringPaymentId: selectedSchedule.id, customer: selectedSchedule.customer, phone: selectedSchedule.phone, email: selectedSchedule.email, vehicle: selectedSchedule.vehicle, amount, frequency: selectedSchedule.frequency, reason: paymentDraft.reason, note: paymentDraft.note });
          setGeneratedUrl(result.paymentLink.url);
          if (paymentDraft.emailLink && draft.email) {
            const firstName = String(draft.name || 'there').split(/\s+/)[0];
            await sendMessage({ customer: draft.name || '', customerId: draft.id, customerAccountId: draft.customerAccountId, phone: draft.phone, email: draft.email, channel: 'Email', deliveryId: `payment-link-${result.paymentLink.id}`, body: `Hi ${firstName}, your WheelsonAuto ${paymentDraft.reason.toLowerCase()} of ${money(amount)} is ready. Pay securely here: ${result.paymentLink.url}` });
            setNotice('Secure payment link created and emailed.');
          } else setNotice('Secure payment link created.');
        }
        if (paymentAction === 'card') {
          const result = await createReplacementCardSetup(selectedSchedule, paymentDraft.provider, paymentDraft.note);
          setGeneratedUrl(result.setupLink.url);
          if (paymentDraft.emailLink && draft.email) {
            const firstName = String(draft.name || 'there').split(/\s+/)[0];
            await sendMessage({ customer: draft.name || '', customerId: draft.id, customerAccountId: draft.customerAccountId, phone: draft.phone, email: draft.email, channel: 'Email', deliveryId: `card-setup-${result.setupLink.id}`, body: `Hi ${firstName}, use this secure WheelsonAuto link to save or update your card on file. No payment is charged while saving the card: ${result.setupLink.url}` });
            setNotice('Secure card setup link created and emailed.');
          } else setNotice('Secure card setup link created.');
        }
        if (paymentAction === 'edit') {
          if (!paymentDraft.nextRun) throw new Error('Choose the exact next charge date.');
          await updateAutopay({ recurringPaymentId: selectedSchedule.id, nextRun: paymentDraft.nextRun, frequency: paymentDraft.frequency, amount, status: paymentDraft.status, chargeTime: paymentDraft.chargeTime, retryRule: 'Retry once then contact', autopayManagedBy: selectedSchedule.autopayManagedBy || 'WheelsonAuto', note: paymentDraft.note, autoChargeEnabled: paymentDraft.autoChargeEnabled });
          setNotice('Autopay amount, schedule, and charging state updated.');
        }
        if (paymentAction === 'remove') {
          await removeAutopay(selectedSchedule.id, paymentDraft.note || 'Removed from WheelsonAuto autopay by admin.');
          setNotice('Autopay removed. The customer file and payment history remain saved.');
        }
        if (paymentAction === 'delete') {
          await deleteCardSetup(selectedSchedule.id);
          setNotice('Pending card setup removed. The customer file remains saved.');
        }
      }
      await refresh(undefined, true);
      if (!generatedUrl && !['new', 'link', 'card'].includes(paymentAction)) { setPaymentAction(null); setPaymentDraft(null); }
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setWorking(false); }
  };

  const viewSwipe = useSwipeTabs(workspaceViews, view, next => { setView(next); setDetailTab(next === 'payments' ? 'payments' : 'customer'); closeDetail(); });
  const filterSwipe = useSwipeTabs(filters, filter, setFilter);
  const detailSwipe = useSwipeTabs(detailTabs, detailTab, setDetailTab);
  const availableVehicles = vehicles.filter(vehicle => !/removed|retired|sold/i.test(vehicle.status || '') && (!vehicle.currentCustomer || normalized(vehicle.currentCustomer) === normalized(draft?.name)));

  const renderPaymentAction = () => {
    if (!paymentAction || !paymentDraft) return null;
    const setupAction = paymentAction === 'new' || paymentAction === 'card';
    return <form className="payment-action-sheet" onSubmit={runPaymentAction}>
      <header><div><span>Admin confirmation</span><strong>{paymentAction === 'new' ? 'Add autopay' : paymentAction === 'charge' ? 'Charge saved card' : paymentAction === 'result' ? 'Record payment result' : paymentAction === 'link' ? 'Send payment link' : paymentAction === 'card' ? 'Change card on file' : paymentAction === 'edit' ? 'Edit autopay' : paymentAction === 'delete' ? 'Delete pending setup' : 'Remove autopay'}</strong></div><button type="button" className="text-command" onClick={() => { setPaymentAction(null); setPaymentDraft(null); setGeneratedUrl(''); }}>Close</button></header>
      {generatedUrl ? <section className="generated-link"><span>Secure link ready</span><input value={generatedUrl} readOnly /><div><button type="button" className="secondary-command compact" onClick={copyGeneratedUrl}><Copy size={14} /> Copy</button><a className="primary-command compact" href={generatedUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a></div></section> : null}
      {!generatedUrl ? <div className="form-grid compact-action-form">
        {paymentAction === 'new' ? <label className="span-2">Exact vehicle<select required value={paymentDraft.vehicleId} onChange={event => setPaymentDraft({ ...paymentDraft, vehicleId: event.target.value })}><option value="">Choose vehicle</option>{availableVehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{[vehicleTitle(vehicle), vehicle.vin && `VIN ${vehicle.vin}`, vehicle.plate || vehicle.stock, vehicle.status].filter(Boolean).join(' | ')}</option>)}</select></label> : null}
        {!['remove', 'delete', 'card'].includes(paymentAction) ? <label>Amount<input type="number" min="0.01" step="0.01" value={paymentDraft.amount} onChange={event => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} /></label> : null}
        {paymentAction === 'result' ? <><label>Result<select value={paymentDraft.result} onChange={event => setPaymentDraft({ ...paymentDraft, result: event.target.value })}><option>Paid</option><option>Pending</option><option>1x failed - retrying</option><option>2x failed - contact customer</option><option>Payment not found - check provider</option></select></label><label>Method<select value={paymentDraft.method} onChange={event => setPaymentDraft({ ...paymentDraft, method: event.target.value })}><option>Paid outside app</option><option>Stripe manual charge</option><option>Clover manual charge</option><option>Cash</option><option>Other</option></select></label></> : null}
        {paymentAction === 'link' ? <label>Reason<select value={paymentDraft.reason} onChange={event => setPaymentDraft({ ...paymentDraft, reason: event.target.value })}><option>Payment needs attention</option><option>Catch-up payment</option><option>One-time payment</option><option>Partial payment</option></select></label> : null}
        {paymentAction === 'card' ? <label>Secure provider<select value={paymentDraft.provider} onChange={event => setPaymentDraft({ ...paymentDraft, provider: event.target.value as 'stripe' | 'clover' })}><option value="stripe">Stripe</option><option value="clover">Clover</option></select></label> : null}
        {['new', 'edit'].includes(paymentAction) ? <><label>Frequency<select value={paymentDraft.frequency} onChange={event => setPaymentDraft({ ...paymentDraft, frequency: event.target.value })}><option>Weekly</option><option>Bi-weekly</option><option>Monthly</option></select></label><label>Charge time<input type="time" value={paymentDraft.chargeTime} onChange={event => setPaymentDraft({ ...paymentDraft, chargeTime: event.target.value })} /></label></> : null}
        {['new', 'charge', 'result', 'edit'].includes(paymentAction) ? <label>Next charge date<input type="date" value={paymentDraft.nextRun} onChange={event => setPaymentDraft({ ...paymentDraft, nextRun: event.target.value })} /></label> : null}
        {paymentAction === 'edit' ? <><label>Status<select value={paymentDraft.status} onChange={event => setPaymentDraft({ ...paymentDraft, status: event.target.value })}><option>Active</option><option>Pending</option><option>1x failed - retrying</option><option>2x failed - contact customer</option><option>Paused</option></select></label><label className="toggle-field"><input type="checkbox" checked={paymentDraft.autoChargeEnabled} onChange={event => setPaymentDraft({ ...paymentDraft, autoChargeEnabled: event.target.checked })} /> Automatic charging enabled</label></> : null}
        <label className="span-2">Internal note<textarea rows={3} value={paymentDraft.note} onChange={event => setPaymentDraft({ ...paymentDraft, note: event.target.value })} placeholder={paymentAction === 'remove' ? 'Why autopay is being removed' : 'Optional receipt, schedule, or customer context'} /></label>
        {setupAction || paymentAction === 'link' ? <label className="toggle-field span-2"><input type="checkbox" checked={paymentDraft.emailLink} disabled={!draft?.email} onChange={event => setPaymentDraft({ ...paymentDraft, emailLink: event.target.checked })} /> Email the secure link to {draft?.email || 'customer email not saved'}</label> : null}
      </div> : null}
      {!generatedUrl ? <><label className="sensitive-confirmation"><input type="checkbox" checked={paymentDraft.confirmed} onChange={event => setPaymentDraft({ ...paymentDraft, confirmed: event.target.checked })} /><span><strong>I confirmed {draft?.name || 'this customer'} and this exact action.</strong><small>{paymentAction === 'charge' ? `This immediately attempts a real ${selectedSchedule?.provider || selectedSchedule?.paymentProvider || 'saved-card'} charge.` : paymentAction === 'remove' || paymentAction === 'delete' ? 'This changes active payment setup, but keeps the customer and history.' : 'WheelsonAuto will save a trackable record of this action.'}</small></span></label><button className={paymentAction === 'remove' || paymentAction === 'delete' ? 'danger-command full-command' : 'primary-command full-command'} disabled={working || !paymentDraft.confirmed}>{working ? 'Working...' : paymentAction === 'charge' ? 'Charge saved card now' : paymentAction === 'result' ? 'Save payment result' : paymentAction === 'link' ? 'Create and send link' : paymentAction === 'card' ? 'Create card setup link' : paymentAction === 'edit' ? 'Save autopay' : paymentAction === 'remove' ? 'Remove autopay' : paymentAction === 'delete' ? 'Delete setup' : 'Create Stripe setup link'}</button></> : null}
    </form>;
  };

  return <main className={`operations-workspace resource-workspace connected-customer-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index">
      <header className="workspace-title"><div><span>One connected customer record</span><h1>Customers</h1></div>{viewed.unreadCount ? <button type="button" className="unread-summary" onClick={viewed.markAllViewed}>{viewed.unreadCount} new</button> : null}</header>
      <div className="workspace-view-switch swipe-tabs" role="tablist" aria-label="Customer workspace" {...viewSwipe}>{workspaceViews.map(key => <button type="button" role="tab" aria-selected={view === key} key={key} className={view === key ? 'active' : ''} onClick={() => { setView(key); setDetailTab(key === 'payments' ? 'payments' : 'customer'); closeDetail(); }}>{key === 'customers' ? <>Customers <b>{customers.length}</b></> : <>Payments <b>{payments.length + autopay.length}</b></>}</button>)}</div>
      <div className="customer-filter-swipe swipe-zone" {...filterSwipe}>
        <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Customer status">{filters.map(key => <button type="button" role="tab" aria-selected={filter === key} key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{key[0].toUpperCase() + key.slice(1)}</span><strong>{counts[key]}</strong></button>)}</div>
        <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customer, vehicle, VIN, tag" /></label>
      </div>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      <div className="record-list">{loading ? <div className="empty-state">Loading connected customer files...</div> : null}{!loading && !visible.length ? <div className="empty-state">No customers match this view.</div> : null}
        {visible.map(customer => { const paymentCount = paymentCountFor(customer); const attention = paymentAttentionFor(customer); return <button type="button" key={customer.id} className={`${customer.id === selectedId ? 'record-row active' : 'record-row'}${viewed.unreadIds.has(customer.id) ? ' unread-record' : ''}`} onClick={() => openCustomer(customer)} aria-label={`Open ${customer.name || 'customer'} file`}>{viewed.unreadIds.has(customer.id) ? <span className="record-unread-dot" aria-label="Unviewed" /> : <span className={`status-line ${statusTone(customer.status || customer.stage)}`} />}<span className="record-main"><strong>{customer.name || 'Unnamed customer'}</strong><span>{customer.vehicle || customer.email || customer.phone || 'Customer file'}</span></span><span className="record-side"><b>{view === 'payments' ? `${paymentCount} payment record${paymentCount === 1 ? '' : 's'}` : customer.status || customer.stage || 'Active'}</b><time>{attention ? `${attention} need attention` : customer.nextRun ? `Due ${shortDate(customer.nextRun)}` : customer.amount ? money(customer.amount) : ''}</time></span></button>; })}
      </div>
    </section>

    <section className="operations-detail">{!draft ? <div className="detail-empty"><strong>Select a customer</strong><span>Customer, vehicle, card, autopay, and transaction history stay in one file.</span></div> : <div className="customer-connected-detail">
      <header className="detail-header"><button type="button" className="detail-back" onClick={closeDetail}>Back</button><div><span>Connected customer file</span><h2>{draft.name || 'Customer'}</h2></div><em className={`status-chip ${statusTone(draft.status || draft.stage)}`}>{draft.status || draft.stage || 'Active'}</em></header>
      <div className="customer-detail-tabs workspace-view-switch swipe-tabs" role="tablist" aria-label="Customer file section" {...detailSwipe}>{detailTabs.map(key => <button type="button" role="tab" aria-selected={detailTab === key} key={key} className={detailTab === key ? 'active' : ''} onClick={() => { setDetailTab(key); setPaymentAction(null); setPaymentDraft(null); }}>{key === 'customer' ? <>Customer <b>1</b></> : <>Payments <b>{selectedCustomerPayments.length + selectedCustomerAutopay.length}</b></>}</button>)}</div>
      <div className="detail-scroll">{error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
        {detailTab === 'customer' ? <form id="connected-customer-form" onSubmit={submitCustomer}>
          <section className="identity-summary"><div><span>Vehicle</span><strong>{draft.vehicle || 'Not assigned'}</strong></div><div><span>Next payment</span><strong>{selectedSchedule?.nextRun ? shortDate(selectedSchedule.nextRun) : draft.nextRun ? shortDate(draft.nextRun) : 'Not scheduled'}</strong></div></section>
          <div className="context-actions">{draft.activeRentalFileId ? <button type="button" className="primary-command compact" onClick={() => onOpenRental(draft.activeRentalFileId || '')}><FileText size={15} /> Rental File</button> : null}<button type="button" className="text-command" onClick={() => onNavigate('messages')}><MessageSquareText size={15} /> Messages</button><button type="button" className="text-command" onClick={() => setDetailTab('payments')}><WalletCards size={15} /> Payments</button></div>
          <div className="form-grid"><label>Phone<input value={draft.phone || ''} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label><label>Email<input type="email" value={draft.email || ''} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label><label className="span-2">Address<input value={draft.address || ''} onChange={event => setDraft({ ...draft, address: event.target.value })} /></label><label>City<input value={draft.city || ''} onChange={event => setDraft({ ...draft, city: event.target.value })} /></label><label>State<input value={draft.state || ''} onChange={event => setDraft({ ...draft, state: event.target.value })} /></label><label>Postal code<input value={draft.postalCode || ''} onChange={event => setDraft({ ...draft, postalCode: event.target.value })} /></label><label>VIN<input readOnly value={draft.vin || ''} /></label><label className="span-2">Notes<textarea rows={5} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label></div>
          <button className="primary-command" disabled={saving}>{saving ? 'Saving...' : 'Save customer details'}</button>
          <section className="assignment-editor"><header><div><span>Fleet connection</span><strong>{draft.vehicleId ? 'Swap assigned vehicle' : 'Assign a vehicle'}</strong></div><CarFront size={19} /></header><label>Exact vehicle<select value={assignmentVehicleId} onChange={event => { setAssignmentVehicleId(event.target.value); setAssignmentConfirmed(false); }}><option value="">Choose vehicle</option>{availableVehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{[vehicleTitle(vehicle), vehicle.vin && `VIN ${vehicle.vin}`, vehicle.plate || vehicle.stock, vehicle.status, vehicle.currentCustomer].filter(Boolean).join(' | ')}</option>)}</select></label><label>Reason<input value={assignmentReason} onChange={event => setAssignmentReason(event.target.value)} /></label><label className="sensitive-confirmation"><input type="checkbox" checked={assignmentConfirmed} onChange={event => setAssignmentConfirmed(event.target.checked)} /><span><strong>I confirmed the customer and exact vehicle.</strong><small>A swap updates Fleet, recurring payments, the customer file, Rental File, and website availability together.</small></span></label><button type="button" className="secondary-command" disabled={working || !assignmentConfirmed || !assignmentVehicleId} onClick={saveAssignment}>{working ? 'Updating...' : 'Save vehicle assignment'}</button></section>
        </form> : <section className="customer-payments-detail">
          <header className="payment-detail-command"><div><span>Payment control</span><strong>{selectedSchedule ? `${money(selectedSchedule.amount)} ${selectedSchedule.frequency || 'Weekly'}` : 'No recurring plan yet'}</strong><small>{selectedSchedule ? `${selectedSchedule.provider || selectedSchedule.paymentProvider || 'Provider'} | Next ${selectedSchedule.nextRun || 'not scheduled'}` : 'Create a secure Stripe setup link to begin.'}</small></div><button type="button" className="primary-command compact" onClick={() => beginAction('new')}><Plus size={15} /> Add autopay</button></header>
          {selectedCustomerAutopay.length > 1 ? <label className="schedule-picker">Recurring plan<select value={selectedSchedule?.id || ''} onChange={event => { setSelectedAutopayId(event.target.value); setPaymentAction(null); }} >{selectedCustomerAutopay.map(row => <option key={row.id} value={row.id}>{[money(row.amount), row.frequency || 'Weekly', row.vehicle || 'No vehicle', row.status || 'Setup'].join(' | ')}</option>)}</select></label> : null}
          {selectedSchedule ? <><section className="payment-schedule-summary"><div><span>Status</span><strong>{selectedSchedule.status || 'Setup needed'}</strong></div><div><span>Card</span><strong>{selectedSchedule.cardLabel || (selectedSchedule.cardLast4 ? `Ending ${selectedSchedule.cardLast4}` : selectedSchedule.paymentSetup || 'Setup needed')}</strong></div><div><span>Autocharge</span><strong>{selectedSchedule.autoChargeEnabled ? 'Enabled' : 'Not enabled'}</strong></div><div><span>Vehicle</span><strong>{selectedSchedule.vehicle || 'Not linked'}</strong></div></section><div className="payment-command-row"><button type="button" className="primary-command compact" onClick={() => beginAction('charge')}><CircleDollarSign size={15} /> Charge</button><button type="button" className="secondary-command compact" onClick={() => beginAction('result')}><WalletCards size={15} /> Record result</button><button type="button" className="secondary-command compact" onClick={() => beginAction('link')}><Send size={15} /> Send link</button><button type="button" className="text-command" onClick={() => beginAction('card')}><CreditCard size={15} /> Change card</button><button type="button" className="text-command" onClick={() => beginAction('edit')}><CalendarClock size={15} /> Edit autopay</button>{/setup|waiting/i.test([selectedSchedule.status, selectedSchedule.paymentSetup].join(' ')) ? <button type="button" className="danger-text-command" onClick={() => beginAction('delete')}><Trash2 size={15} /> Delete setup</button> : <button type="button" className="danger-text-command" onClick={() => beginAction('remove')}><Trash2 size={15} /> Remove autopay</button>}</div></> : null}
          {renderPaymentAction()}
          <section className="transaction-history"><header><div><span>History</span><strong>Transactions</strong></div><b>{selectedCustomerPayments.length}</b></header>{selectedCustomerPayments.length ? selectedCustomerPayments.map(payment => <article key={payment.id}><span className={`status-line ${statusTone(payment.status)}`} /><div><strong>{money(payment.amount)} | {payment.status || 'Recorded'}</strong><small>{[payment.vehicle, payment.method || payment.provider, dateTime(payment.createdAt || payment.date)].filter(Boolean).join(' | ')}</small></div>{payment.rentalFileId ? <button type="button" className="text-command" onClick={() => onOpenRental(payment.rentalFileId || '')}><FileText size={14} /> File</button> : null}</article>) : <div className="empty-state compact">No transactions are connected to this customer yet.</div>}</section>
        </section>}
      </div>
    </div>}</section>
  </main>;
}
