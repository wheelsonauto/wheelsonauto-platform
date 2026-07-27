import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { createAutopay, loadAutopay, loadCustomers, loadPayments, loadVehicles, sendMessage } from '../api';
import type { CustomerRecord, PaymentRecord, RecurringPaymentRecord, VehicleRecord } from '../types';
import { dateTime, money, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';

type TransactionFilter = 'all' | 'paid' | 'attention' | 'unmatched';
type AutopayFilter = 'all' | 'active' | 'setup' | 'attention';
type PaymentView = 'transactions' | 'autopay';
const paymentViews: readonly PaymentView[] = ['transactions', 'autopay'];
const transactionFilters: readonly TransactionFilter[] = ['all', 'paid', 'attention', 'unmatched'];
const autopayFilters: readonly AutopayFilter[] = ['all', 'active', 'setup', 'attention'];
type AutopayDraft = {
  customer: string;
  phone: string;
  email: string;
  vehicleId: string;
  amount: string;
  frequency: string;
  nextRun: string;
  chargeTime: string;
  notes: string;
  confirmed: boolean;
};

const emptyAutopay = (): AutopayDraft => ({
  customer: '', phone: '', email: '', vehicleId: '', amount: '', frequency: 'Weekly',
  nextRun: '', chargeTime: '18:00', notes: '', confirmed: false
});

function provider(payment: PaymentRecord) {
  return payment.paymentProvider || payment.provider || (/stripe/i.test([payment.method, payment.source].join(' ')) ? 'Stripe' : /clover/i.test([payment.method, payment.source].join(' ')) ? 'Clover' : 'Recorded');
}

function vehicleName(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vin || 'Unnamed vehicle';
}

function autopayProvider(row: RecurringPaymentRecord) {
  return row.provider || row.paymentProvider || 'Stripe';
}

function scheduleDate(row: RecurringPaymentRecord) {
  return [row.nextRun, row.chargeTime].filter(Boolean).join(' ') || 'After card setup';
}

export function PaymentsPage({ onOpenRental }: { onOpenRental: (rentalId: string) => void }) {
  const owner = String(window.__WOA_STAFF_USER__?.role || '').toLowerCase() === 'owner';
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [autopay, setAutopay] = useState<RecurringPaymentRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [view, setView] = useState<PaymentView>('transactions');
  const [selectedPaymentId, setSelectedPaymentId] = useState('');
  const [selectedAutopayId, setSelectedAutopayId] = useState('');
  const [draft, setDraft] = useState<AutopayDraft | null>(null);
  const [setupUrl, setSetupUrl] = useState('');
  const [query, setQuery] = useState('');
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all');
  const [autopayFilter, setAutopayFilter] = useState<AutopayFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [paymentFeed, autopayFeed, customerFeed, vehicleFeed] = await Promise.all([
        loadPayments(signal, force),
        owner ? loadAutopay(signal, force) : Promise.resolve(null),
        owner ? loadCustomers(signal, force) : Promise.resolve(null),
        owner ? loadVehicles(signal, force) : Promise.resolve(null)
      ]);
      setPayments(paymentFeed.records || []);
      if (owner && autopayFeed && customerFeed && vehicleFeed) {
        setAutopay(autopayFeed.records || []);
        setCustomers(customerFeed.records || []);
        setVehicles(vehicleFeed.records || []);
      }
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).some((topic: string) => topic === 'payments' || topic === 'assignments')) void refresh(undefined, true);
      } catch { /* The next valid event repairs the view. */ }
    });
    return () => { controller.abort(); events.close(); };
  }, [owner]);

  const orderedPayments = useMemo(() => payments.slice().sort((a, b) => (Date.parse(b.createdAt || b.date || '') || 0) - (Date.parse(a.createdAt || a.date || '') || 0)), [payments]);
  const visiblePayments = useMemo(() => orderedPayments.filter(payment => {
    const status = String(payment.status || '').toLowerCase();
    if (transactionFilter === 'paid' && !/paid|succeeded|complete/.test(status)) return false;
    if (transactionFilter === 'attention' && !/failed|declined|pending|not found|review/.test(status)) return false;
    if (transactionFilter === 'unmatched' && !/unmatched|unknown/.test([payment.customer, status].join(' ').toLowerCase())) return false;
    return wordsMatch(query, [payment.customer, payment.vehicle, payment.vin, payment.plate, payment.method, payment.source, payment.status, payment.id]);
  }), [orderedPayments, query, transactionFilter]);

  const orderedAutopay = useMemo(() => autopay.slice().sort((a, b) => {
    const attentionA = /failed|declined|not found|review/i.test(a.status || '') ? 0 : /setup|waiting/i.test(a.status || '') ? 1 : 2;
    const attentionB = /failed|declined|not found|review/i.test(b.status || '') ? 0 : /setup|waiting/i.test(b.status || '') ? 1 : 2;
    return attentionA - attentionB || String(a.nextRun || '').localeCompare(String(b.nextRun || '')) || String(a.customer || '').localeCompare(String(b.customer || ''));
  }), [autopay]);
  const visibleAutopay = useMemo(() => orderedAutopay.filter(row => {
    const status = String([row.status, row.paymentSetup].join(' ')).toLowerCase();
    if (autopayFilter === 'active' && !/active/.test(status)) return false;
    if (autopayFilter === 'setup' && !/setup|waiting|card/.test(status)) return false;
    if (autopayFilter === 'attention' && !/failed|declined|not found|review|paused/.test(status)) return false;
    return wordsMatch(query, [row.customer, row.phone, row.email, row.vehicle, row.vin, row.licensePlate, row.plate, row.tracker, row.status, row.paymentSetup, row.nextRun]);
  }), [orderedAutopay, query, autopayFilter]);

  const selectedPayment = payments.find(row => row.id === selectedPaymentId) || null;
  const selectedSchedule = autopay.find(row => row.id === selectedAutopayId) || null;
  const hasDetail = !!(selectedPayment || selectedSchedule || draft);
  const paid = payments.filter(row => /paid|succeeded|complete/i.test(row.status || ''));
  const transactionCounts = {
    all: payments.length,
    paid: paid.length,
    attention: payments.filter(row => /failed|declined|pending|not found|review/i.test(row.status || '')).length,
    unmatched: payments.filter(row => /unmatched|unknown/i.test([row.customer, row.status].join(' '))).length
  };
  const autopayCounts = {
    all: autopay.length,
    active: autopay.filter(row => /active/i.test(row.status || '')).length,
    setup: autopay.filter(row => /setup|waiting|card/i.test([row.status, row.paymentSetup].join(' '))).length,
    attention: autopay.filter(row => /failed|declined|not found|review|paused/i.test(row.status || '')).length
  };

  const closeDetail = () => {
    setSelectedPaymentId(''); setSelectedAutopayId(''); setDraft(null); setSetupUrl(''); setError(''); setNotice('');
  };

  const viewSwipe = useSwipeTabs(paymentViews, view, next => { closeDetail(); setView(next); });
  const transactionSwipe = useSwipeTabs(transactionFilters, transactionFilter, setTransactionFilter);
  const autopaySwipe = useSwipeTabs(autopayFilters, autopayFilter, setAutopayFilter);

  const openNew = () => {
    setView('autopay'); setSelectedPaymentId(''); setSelectedAutopayId(''); setDraft(emptyAutopay()); setSetupUrl(''); setError(''); setNotice('');
  };

  const selectCustomer = (name: string) => {
    if (!draft) return;
    const customer = customers.find(row => String(row.name || '').toLowerCase() === name.trim().toLowerCase());
    const linkedVehicle = customer && vehicles.find(row => row.id === customer.vehicleId) || vehicles.find(row => String(row.currentCustomer || '').toLowerCase() === name.trim().toLowerCase());
    setDraft({
      ...draft,
      customer: name,
      phone: customer?.phone || draft.phone,
      email: customer?.email || draft.email,
      vehicleId: linkedVehicle?.id || customer?.vehicleId || draft.vehicleId,
      amount: String(customer?.amount || draft.amount || '')
    });
  };

  const submitAutopay = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    const vehicle = vehicles.find(row => row.id === draft.vehicleId);
    const amount = Number(draft.amount);
    if (!draft.customer.trim() || !vehicle || !Number.isFinite(amount) || amount <= 0 || !draft.nextRun || !draft.confirmed) {
      setError('Choose the customer and exact vehicle, enter an amount and first charge date, then confirm the setup-link action.');
      return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const plate = vehicle.plate || vehicle.stock || '';
      const result = await createAutopay({
        customer: draft.customer.trim(), phone: draft.phone.trim(), email: draft.email.trim(),
        vehicle: vehicleName(vehicle), vehicleId: vehicle.id, vin: vehicle.vin || '', licensePlate: plate,
        plate, tempTag: vehicle.tempTag || '', tracker: vehicle.tracker || '', amount,
        frequency: draft.frequency, nextRun: draft.nextRun, chargeTime: draft.chargeTime,
        notes: draft.notes.trim() || 'Stripe card setup created from the staff Payments workspace.'
      });
      setSetupUrl(result.setupLink.url);
      setNotice('Autopay plan saved. No charge was made. Send the secure Stripe card link to the customer.');
      await refresh(undefined, true);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const copySetupLink = async () => {
    try { await navigator.clipboard.writeText(setupUrl); setNotice('Secure setup link copied.'); }
    catch { setError('The browser could not copy the link. Open the secure setup page and copy its address.'); }
  };

  const emailSetupLink = async () => {
    if (!draft?.email || !setupUrl || emailing) return;
    setEmailing(true); setError('');
    try {
      const firstName = draft.customer.trim().split(/\s+/)[0] || 'there';
      const result = await sendMessage({
        customer: draft.customer.trim(), phone: draft.phone.trim(), email: draft.email.trim(), channel: 'Email',
        deliveryId: `autopay-setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        body: `Hi ${firstName}, use this secure WheelsonAuto link to save your card for weekly autopay. No payment is charged while saving the card: ${setupUrl}`
      });
      setNotice(result.sent ? 'Secure Stripe setup link emailed.' : (result.warning || 'Email was saved as a draft because the provider needs attention.'));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setEmailing(false);
    }
  };

  return <main className={`operations-workspace resource-workspace ${hasDetail ? 'has-detail' : ''}`}>
    <section className="operations-index">
      <header className="workspace-title">
        <div><span>{view === 'autopay' ? 'Recurring schedules' : 'Unified transaction ledger'}</span><h1>Payments</h1></div>
        <div className="workspace-head-actions">
          {view === 'transactions' ? <div className="workspace-total"><span>Loaded total</span><strong>{money(paid.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong></div> : null}
          {owner ? <button className="primary-command" onClick={openNew}>Add autopay</button> : null}
        </div>
      </header>
      {owner ? <div className="workspace-view-switch swipe-tabs" role="tablist" aria-label="Payment view" {...viewSwipe}>{paymentViews.map(key => <button role="tab" aria-selected={view === key} key={key} className={view === key ? 'active' : ''} onClick={() => { closeDetail(); setView(key); }}>{key === 'transactions' ? 'Transactions' : 'Autopay'}</button>)}</div> : null}
      {view === 'transactions' ? <div className="compact-metrics four swipe-tabs" role="tablist" aria-label="Transaction status" {...transactionSwipe}>{transactionFilters.map(key => <button role="tab" aria-selected={transactionFilter === key} key={key} className={transactionFilter === key ? 'active' : ''} onClick={() => setTransactionFilter(key)}><span>{key[0].toUpperCase() + key.slice(1)}</span><strong>{transactionCounts[key]}</strong></button>)}</div> : <div className="compact-metrics four swipe-tabs" role="tablist" aria-label="Autopay status" {...autopaySwipe}>{autopayFilters.map(key => <button role="tab" aria-selected={autopayFilter === key} key={key} className={autopayFilter === key ? 'active' : ''} onClick={() => setAutopayFilter(key)}><span>{key[0].toUpperCase() + key.slice(1)}</span><strong>{autopayCounts[key]}</strong></button>)}</div>}
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'autopay' ? 'Search customer, vehicle, VIN, tag, tracker' : 'Search name, vehicle, VIN, tag, transaction'} /></label>
      {error && !hasDetail ? <div className="inline-alert error">{error}</div> : null}
      {view === 'transactions' ? <div className="record-list payment-records">
        {loading ? <div className="empty-state">Loading transactions...</div> : null}
        {!loading && !visiblePayments.length ? <div className="empty-state">No transactions match this view.</div> : null}
        {visiblePayments.map(payment => <button key={payment.id} className={payment.id === selectedPaymentId ? 'record-row active' : 'record-row'} onClick={() => { setSelectedPaymentId(payment.id); setSelectedAutopayId(''); setDraft(null); }}><span className={`status-line ${statusTone(payment.status)}`} /><span className="record-main"><strong>{payment.customer || 'Unmatched payment'}</strong><span>{[payment.vehicle, provider(payment), dateTime(payment.createdAt || payment.date)].filter(Boolean).join(' | ')}</span></span><span className="record-side"><b>{money(payment.amount)}</b><time>{payment.status || 'Recorded'}</time></span></button>)}
      </div> : <div className="record-list payment-records">
        {loading ? <div className="empty-state">Loading autopay schedules...</div> : null}
        {!loading && !visibleAutopay.length ? <div className="empty-state">No autopay schedules match this view.</div> : null}
        {visibleAutopay.map(row => <button key={row.id} className={row.id === selectedAutopayId ? 'record-row active' : 'record-row'} onClick={() => { setSelectedAutopayId(row.id); setSelectedPaymentId(''); setDraft(null); }}><span className={`status-line ${statusTone(row.status)}`} /><span className="record-main"><strong>{row.customer || 'Customer not linked'}</strong><span>{[row.vehicle, autopayProvider(row), scheduleDate(row)].filter(Boolean).join(' | ')}</span></span><span className="record-side"><b>{money(row.amount)}</b><time>{row.status || 'Setup needed'}</time></span></button>)}
      </div>}
    </section>

    <section className="operations-detail">
      {draft ? <form onSubmit={submitAutopay}>
        <header className="detail-header"><button type="button" className="detail-back" onClick={closeDetail}>Back</button><div><span>Stripe recurring card</span><h2>Add autopay</h2></div><em className="status-chip warn">Setup only</em></header>
        <div className="detail-scroll">
          {error ? <div className="inline-alert error">{error}</div> : null}{notice ? <div className="inline-alert">{notice}</div> : null}
          {setupUrl ? <section className="autopay-link-ready"><span>Secure card setup ready</span><strong>{draft.customer}</strong><p>No payment was charged and the vehicle was not removed from inventory. The schedule activates only after Stripe confirms a saved card and the business workflow allows charging.</p><div><button type="button" className="secondary-command" onClick={copySetupLink}>Copy link</button><a className="secondary-command" href={setupUrl} target="_blank" rel="noreferrer">Open secure setup</a><button type="button" className="primary-command" onClick={emailSetupLink} disabled={!draft.email || emailing}>{emailing ? 'Sending...' : 'Email link'}</button></div></section> : null}
          <div className="form-grid">
            <label className="span-2">Customer<input required list="autopay-customer-options" value={draft.customer} disabled={!!setupUrl} onChange={event => selectCustomer(event.target.value)} placeholder="Search or enter customer name" /><datalist id="autopay-customer-options">{customers.map(customer => <option key={customer.id} value={customer.name || ''}>{[customer.phone, customer.email].filter(Boolean).join(' | ')}</option>)}</datalist></label>
            <label>Phone<input value={draft.phone} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, phone: event.target.value })} inputMode="tel" /></label>
            <label>Email<input value={draft.email} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, email: event.target.value })} inputMode="email" /></label>
            <label className="span-2">Exact vehicle<select required value={draft.vehicleId} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, vehicleId: event.target.value })}><option value="">Choose vehicle</option>{vehicles.filter(vehicle => !/removed/i.test(vehicle.status || '')).map(vehicle => <option key={vehicle.id} value={vehicle.id}>{[vehicleName(vehicle), vehicle.vin ? `VIN ${vehicle.vin}` : '', vehicle.plate || vehicle.stock ? `Tag ${vehicle.plate || vehicle.stock}` : '', vehicle.currentCustomer || vehicle.status].filter(Boolean).join(' | ')}</option>)}</select></label>
            <label>Recurring amount<input required type="number" min="0.01" step="0.01" value={draft.amount} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label>
            <label>Frequency<select value={draft.frequency} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, frequency: event.target.value })}><option>Weekly</option><option>Every 2 weeks</option><option>Monthly</option></select></label>
            <label>First charge date<input required type="date" value={draft.nextRun} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, nextRun: event.target.value })} /></label>
            <label>Charge time<input required type="time" value={draft.chargeTime} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, chargeTime: event.target.value })} /></label>
            <label className="span-2">Notes<textarea rows={4} value={draft.notes} disabled={!!setupUrl} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Reason, migration note, or schedule context" /></label>
          </div>
          {!setupUrl ? <label className="autopay-confirmation"><input type="checkbox" checked={draft.confirmed} onChange={event => setDraft({ ...draft, confirmed: event.target.checked })} /><span><strong>Create a Stripe card-setup link</strong><small>This saves the plan but does not charge the customer, activate autopay, or change the vehicle's inventory status.</small></span></label> : null}
        </div>
        <footer className="detail-actions">{!setupUrl ? <button className="primary-command" disabled={saving || !draft.confirmed}>{saving ? 'Creating...' : 'Create Stripe setup link'}</button> : <button type="button" className="primary-command" onClick={closeDetail}>Done</button>}</footer>
      </form> : selectedSchedule ? <div className="static-detail">
        <header className="detail-header"><button className="detail-back" onClick={closeDetail}>Back</button><div><span>Autopay schedule</span><h2>{selectedSchedule.customer || 'Customer not linked'}</h2></div><em className={`status-chip ${statusTone(selectedSchedule.status)}`}>{selectedSchedule.status || 'Setup needed'}</em></header>
        <div className="detail-scroll"><section className="money-summary"><span>{autopayProvider(selectedSchedule)} / {selectedSchedule.frequency || 'Weekly'}</span><strong>{money(selectedSchedule.amount)}</strong><small>{scheduleDate(selectedSchedule)}</small></section><dl className="detail-list"><div><dt>Vehicle</dt><dd>{selectedSchedule.vehicle || 'Not linked'}</dd></div><div><dt>VIN</dt><dd>{selectedSchedule.vin || 'Not linked'}</dd></div><div><dt>Tag / plate</dt><dd>{selectedSchedule.licensePlate || selectedSchedule.plate || 'Not linked'}</dd></div><div><dt>Tracker</dt><dd>{selectedSchedule.tracker || 'Not linked'}</dd></div><div><dt>Card</dt><dd>{selectedSchedule.cardLabel || (selectedSchedule.cardLast4 ? `Ending ${selectedSchedule.cardLast4}` : selectedSchedule.paymentSetup || 'Setup needed')}</dd></div><div><dt>Charging</dt><dd>{selectedSchedule.autoChargeEnabled ? 'Enabled' : 'Not enabled'}</dd></div><div><dt>Managed by</dt><dd>{selectedSchedule.autopayManagedBy || autopayProvider(selectedSchedule)}</dd></div></dl>{selectedSchedule.notes ? <section className="detail-note"><span>Notes</span><p>{selectedSchedule.notes}</p></section> : null}</div>
      </div> : selectedPayment ? <div className="static-detail">
        <header className="detail-header"><button className="detail-back" onClick={closeDetail}>Back</button><div><span>Transaction</span><h2>{selectedPayment.customer || 'Unmatched payment'}</h2></div><em className={`status-chip ${statusTone(selectedPayment.status)}`}>{selectedPayment.status || 'Recorded'}</em></header>
        <div className="detail-scroll"><section className="money-summary"><span>{provider(selectedPayment)}</span><strong>{money(selectedPayment.amount)}</strong><small>{dateTime(selectedPayment.createdAt || selectedPayment.date)}</small></section>{selectedPayment.rentalFileId ? <div className="context-actions"><button className="primary-command compact" onClick={() => onOpenRental(selectedPayment.rentalFileId || '')}>Open Rental File</button></div> : null}<dl className="detail-list"><div><dt>Customer</dt><dd>{selectedPayment.customer || 'Needs exact match'}</dd></div><div><dt>Vehicle</dt><dd>{selectedPayment.vehicle || 'Not linked'}</dd></div><div><dt>VIN</dt><dd>{selectedPayment.vin || 'Not linked'}</dd></div><div><dt>Tag / plate</dt><dd>{selectedPayment.plate || 'Not linked'}</dd></div><div><dt>Method</dt><dd>{selectedPayment.method || provider(selectedPayment)}</dd></div><div><dt>Source</dt><dd>{selectedPayment.source || provider(selectedPayment)}</dd></div><div><dt>Reference</dt><dd>{selectedPayment.id}</dd></div></dl>{selectedPayment.notes ? <section className="detail-note"><span>Notes</span><p>{selectedPayment.notes}</p></section> : null}</div>
      </div> : <div className="detail-empty"><strong>Select a {view === 'autopay' ? 'schedule' : 'transaction'}</strong><span>{view === 'autopay' ? 'Review recurring amount, card state, vehicle, and next charge.' : 'Review the exact customer, vehicle, amount, source, and status.'}</span></div>}
    </section>
  </main>;
}
