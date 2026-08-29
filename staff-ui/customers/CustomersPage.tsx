import { lazy, Suspense, type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  FileText,
  Plus,
  Send,
  Trash2,
  WalletCards,
  X
} from 'lucide-react';
import {
  assignCustomerVehicle,
  archiveCustomer,
  cancelScheduledPayment,
  chargeSavedCard,
  createAutopay,
  createCustomer,
  createPaymentLink,
  createReplacementCardSetup,
  deleteCardSetup,
  loadAutopay,
  loadClaims,
  loadCustomers,
  loadPayments,
  loadScheduledPayments,
  loadVehicles,
  recordManualPaymentResult,
  removeAutopay,
  sendMessage,
  scheduleOneTimePayment,
  updateAutopay,
  updateCustomer
} from '../api';
import type { ClaimRecord, CustomerRecord, PaymentRecord, RecurringPaymentRecord, ScheduledPaymentRecord, VehicleRecord } from '../types';
import { canonicalCustomerRecords, dateTime, money, normalized, shortDate, statusTone, wordsMatch } from '../ui';
import { useSwipeTabs } from '../useSwipeTabs';
import { useViewedRecords } from '../useViewedRecords';
import type { ActionDraft, PaymentAction } from './CustomerPaymentActionPanel';

const CustomerDuesPanel = lazy(() => import('./CustomerDuesPanel').then(module => ({ default: module.CustomerDuesPanel })));
const CustomerProfilePanel = lazy(() => import('./CustomerProfilePanel').then(module => ({ default: module.CustomerProfilePanel })));
const CustomerTransactionsPanel = lazy(() => import('./CustomerTransactionsPanel').then(module => ({ default: module.CustomerTransactionsPanel })));
const CustomerPaymentActionPanel = lazy(() => import('./CustomerPaymentActionPanel').then(module => ({ default: module.CustomerPaymentActionPanel })));

type Filter = 'active' | 'dues' | 'history' | 'transactions';
type DetailTab = 'customer' | 'payments' | 'dues';

const filters: readonly Filter[] = ['active', 'dues', 'history', 'transactions'];
const filterLabels: Record<Filter, string> = { active: 'Active', dues: 'Tolls / violations & dues', history: 'History', transactions: 'Transactions' };

function nowLocalInput() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function sameCustomer(row: PaymentRecord | RecurringPaymentRecord | ScheduledPaymentRecord, customer: CustomerRecord) {
  if (row.customerId && String(row.customerId) === String(customer.id)) return true;
  if (row.customerAccountId && customer.customerAccountId && String(row.customerAccountId) === String(customer.customerAccountId)) return true;
  return !!(row.customer && customer.name && normalized(row.customer) === normalized(customer.name));
}

function sameClaim(row: ClaimRecord, customer: CustomerRecord) {
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

function rapidFrequency(value?: string) {
  return /every (minute|hour)/i.test(String(value || ''));
}

function completedAutopay(row?: RecurringPaymentRecord | null) {
  return !!row?.autopayComplete || /^rapid test passed$/i.test(String(row?.status || ''));
}

function dateTimeInput(value?: string) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function futureDateTimeInput(minutes = 5) {
  const date = new Date(Date.now() + minutes * 60_000);
  date.setSeconds(0, 0);
  return dateTimeInput(date.toISOString());
}

function scheduleValue(frequency: string, value: string) {
  if (!rapidFrequency(frequency)) return dateInput(value);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function scheduleText(value?: string) {
  return String(value || '').includes('T') ? dateTime(value) : shortDate(value);
}

function clockTime(value?: string) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 'time not set';
  const hour = Number(match[1]);
  const minute = match[2];
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function autopayStartText(frequency: string, nextRun: string, chargeTime: string) {
  return rapidFrequency(frequency) ? dateTime(nextRun) : `${shortDate(nextRun)} at ${clockTime(chargeTime)}`;
}

function operationId() {
  return `staff-payment-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function actionDraft(row: RecurringPaymentRecord | null, customer: CustomerRecord, action: PaymentAction): ActionDraft {
  const provider = /clover/i.test(String(row?.paymentProvider || row?.provider || '')) ? 'clover' : 'stripe';
  const frequency = row?.frequency || 'Weekly';
  return {
    amount: String(row?.amount || customer.amount || ''),
    frequency,
    nextRun: rapidFrequency(frequency) ? dateTimeInput(row?.nextRun) : dateInput(row?.nextRun),
    chargeTime: rapidFrequency(frequency) ? '' : row?.chargeTime || '18:00',
    scheduledFor: futureDateTimeInput(),
    status: action === 'edit' && (completedAutopay(row) || /setup/i.test(row?.status || '')) ? 'Active' : row?.status || 'Active',
    result: 'Paid',
    method: 'Paid outside app',
    reason: action === 'link' ? 'Payment needs attention' : action === 'card' ? 'Change card on file' : '',
    chargePurpose: 'one_time',
    note: '',
    provider,
    vehicleId: row?.vehicleId || customer.vehicleId || '',
    autoChargeEnabled: !!row?.autoChargeEnabled,
    collectionOverrideUntil: dateTimeInput(row?.collectionOverrideUntil),
    collectionOverrideReason: row?.collectionOverrideReason || '',
    collectionSuppressLateFee: !!row?.collectionSuppressLateFee,
    collectionSuppressTow: !!row?.collectionSuppressTow,
    emailLink: !!customer.email,
    confirmed: false,
    operationId: operationId()
  };
}

function cardDisplay(row: RecurringPaymentRecord) {
  const brand = String(row.cardLabel || '').trim();
  const last4 = String(row.cardLast4 || '').trim();
  if (brand && last4) return `${brand} ending ${last4}`;
  if (last4) return `Card ending ${last4}`;
  return brand || row.paymentSetup || 'Setup needed';
}

function claimBalance(row: ClaimRecord) {
  return Math.max(0, Number(row.remainingAmount ?? row.amount ?? 0));
}

function failedPaymentBalance(row: PaymentRecord) {
  if (row.createsDue === false || row.balanceEffect === 'none') return 0;
  if (/manual saved-card charge|one-time saved-card charge/i.test(String(row.source || ''))) return 0;
  return Math.max(0, Number(row.balanceRemaining ?? row.amount ?? 0));
}

export function CustomersPage({ onNavigate, onOpenRental }: { onNavigate: (workspace: string, recordId?: string) => void; onOpenRental: (rentalId: string) => void }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [autopay, setAutopay] = useState<RecurringPaymentRecord[]>([]);
  const [scheduledPayments, setScheduledPayments] = useState<ScheduledPaymentRecord[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedAutopayId, setSelectedAutopayId] = useState('');
  const [draft, setDraft] = useState<CustomerRecord | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('payments');
  const [detailTrail, setDetailTrail] = useState<DetailTab[]>([]);
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
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [archiveEndAt, setArchiveEndAt] = useState(nowLocalInput());
  const [archiveReason, setArchiveReason] = useState('Customer contract ended and vehicle returned.');
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const [customerFeed, paymentFeed, autopayFeed, scheduledFeed, vehicleFeed, claimFeed] = await Promise.all([
        loadCustomers(signal, force), loadPayments(signal, force), loadAutopay(signal, force), loadScheduledPayments(signal, force), loadVehicles(signal, force), loadClaims(signal, force)
      ]);
      setCustomers(customerFeed.records || []);
      setPayments(paymentFeed.records || []);
      setAutopay(autopayFeed.records || []);
      setScheduledPayments(scheduledFeed.records || []);
      setVehicles(vehicleFeed.records || []);
      setClaims(claimFeed.records || []);
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    events.addEventListener('platform', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).some((topic: string) => ['customers', 'payments', 'assignments', 'claims'].includes(topic))) void refresh(undefined, true);
      } catch { /* A later event repairs the view. */ }
    });
    return () => { controller.abort(); events.close(); };
  }, []);
  const customerRows = useMemo(() => canonicalCustomerRecords(customers, vehicles), [customers, vehicles]);
  useEffect(() => {
    const customer = customerRows.find(row => row.id === selectedId);
    if (!customer) return;
    setDraft({ ...customer });
    setAssignmentVehicleId(customer.vehicleId || '');
  }, [selectedId, customerRows]);

  const viewed = useViewedRecords('customers', customerRows, !loading);
  const paymentCountFor = (customer: CustomerRecord) => payments.filter(row => sameCustomer(row, customer)).length + autopay.filter(row => sameCustomer(row, customer)).length;
  const paymentAttentionFor = (customer: CustomerRecord) => autopay.filter(row => sameCustomer(row, customer) && /failed|declined|not found|contact|past due/i.test([row.status, row.paymentSetup].join(' '))).length + payments.filter(row => sameCustomer(row, customer) && /failed|declined|unpaid|past due/i.test(row.status || '') && failedPaymentBalance(row) > 0).length;
  const openClaimsFor = (customer: CustomerRecord) => claims.filter(row => sameClaim(row, customer) && !/paid|closed|resolved|dismissed|cancelled/i.test(row.status || '') && claimBalance(row) > 0);
  const hasAssignedVehicle = (customer: CustomerRecord) => vehicles.some(vehicle => !/removed|retired|sold/i.test(vehicle.status || '') && normalized(vehicle.currentCustomer) === normalized(customer.name)) || !!(customer.activeRentalFileId && customer.vehicleId && vehicles.some(vehicle => vehicle.id === customer.vehicleId && !/removed|retired|sold/i.test(vehicle.status || '')));
  const dueAmountFor = (customer: CustomerRecord) => {
    const failedPayments = payments.filter(row => sameCustomer(row, customer) && /failed|declined|unpaid|past due/i.test(row.status || '')).reduce((sum, row) => sum + failedPaymentBalance(row), 0);
    const failedSchedules = autopay.filter(row => sameCustomer(row, customer) && /failed|declined|not found|contact|past due/i.test([row.status, row.paymentSetup].join(' ')));
    const scheduleAmount = failedPayments ? 0 : failedSchedules.reduce((sum, row) => sum + Math.max(0, Number(row.outstandingBalance ?? row.amount ?? 0)), 0);
    return openClaimsFor(customer).reduce((sum, row) => sum + claimBalance(row), 0) + failedPayments + scheduleAmount;
  };
  const hasDues = (customer: CustomerRecord) => paymentAttentionFor(customer) > 0 || openClaimsFor(customer).length > 0;
  const visible = useMemo(() => customerRows.filter(customer => {
    const active = hasAssignedVehicle(customer);
    if (filter === 'history' && active) return false;
    if (filter === 'dues' && !hasDues(customer)) return false;
    if (filter === 'active' && !active) return false;
    return wordsMatch(query, [customer.name, customer.phone, customer.email, customer.vehicle, customer.vin, customer.licensePlate, customer.status]);
  }).sort((a, b) => filter === 'dues' ? dueAmountFor(b) - dueAmountFor(a) || String(a.name || '').localeCompare(String(b.name || '')) : String(a.name || '').localeCompare(String(b.name || ''))), [customerRows, vehicles, payments, autopay, claims, query, filter]);

  const counts = {
    active: customerRows.filter(hasAssignedVehicle).length,
    dues: customerRows.filter(hasDues).length,
    history: customerRows.filter(row => !hasAssignedVehicle(row)).length,
    transactions: payments.length
  };
  const selectedCustomerPayments = useMemo(() => draft ? payments.filter(row => sameCustomer(row, draft)).sort((a, b) => (Date.parse(b.createdAt || b.date || '') || 0) - (Date.parse(a.createdAt || a.date || '') || 0)) : [], [draft, payments]);
  const selectedCustomerAutopay = useMemo(() => draft ? autopay.filter(row => sameCustomer(row, draft)).sort((a, b) => Number(/failed|declined|not found|review|paused/i.test(b.status || '')) - Number(/failed|declined|not found|review|paused/i.test(a.status || '')) || String(a.nextRun || '').localeCompare(String(b.nextRun || ''))) : [], [draft, autopay]);
  const selectedScheduledPayments = useMemo(() => draft ? scheduledPayments.filter(row => sameCustomer(row, draft)).sort((a, b) => String(b.scheduledFor || '').localeCompare(String(a.scheduledFor || ''))) : [], [draft, scheduledPayments]);
  const selectedClaims = useMemo(() => draft ? claims.filter(row => sameClaim(row, draft)).sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0)) : [], [claims, draft]);
  const selectedOpenClaims = selectedClaims.filter(row => !/paid|closed|resolved|dismissed|cancelled|removed/i.test(row.status || '') && claimBalance(row) > 0);
  const selectedFailedPayments = selectedCustomerPayments.filter(row => /failed|declined|unpaid|past due/i.test(row.status || '') && failedPaymentBalance(row) > 0);
  const selectedDueTotal = draft ? dueAmountFor(draft) : 0;
  const selectedSchedule = selectedCustomerAutopay.find(row => row.id === selectedAutopayId) || selectedCustomerAutopay[0] || null;

  useEffect(() => {
    if (!selectedCustomerAutopay.length) { setSelectedAutopayId(''); return; }
    if (!selectedCustomerAutopay.some(row => row.id === selectedAutopayId)) setSelectedAutopayId(selectedCustomerAutopay[0].id);
  }, [selectedCustomerAutopay, selectedAutopayId]);

  const closeDetail = () => {
    setDraft(null); setSelectedId(''); setCreatingCustomer(false); setDetailTrail([]); setPaymentAction(null); setPaymentDraft(null); setGeneratedUrl(''); setArchiveConfirmed(false); setError(''); setNotice('');
  };
  const navigateDetail = (next: DetailTab) => {
    if (next === detailTab) return;
    setDetailTrail(current => [...current, detailTab]);
    setDetailTab(next); setPaymentAction(null); setPaymentDraft(null); setGeneratedUrl(''); setError(''); setNotice('');
  };
  const backDetail = () => {
    if (paymentAction) { setPaymentAction(null); setPaymentDraft(null); setGeneratedUrl(''); return; }
    if (detailTrail.length) {
      const previous = detailTrail[detailTrail.length - 1];
      setDetailTrail(current => current.slice(0, -1)); setDetailTab(previous); return;
    }
    closeDetail();
  };
  const openCustomer = (customer: CustomerRecord) => {
    viewed.markViewed(customer.id);
    setSelectedId(customer.id); setDraft({ ...customer }); setCreatingCustomer(false); setAssignmentVehicleId(customer.vehicleId || ''); setDetailTab('payments'); setDetailTrail([]); setPaymentAction(null); setPaymentDraft(null); setArchiveEndAt(nowLocalInput()); setArchiveConfirmed(false); setError(''); setNotice('');
  };
  const openNewCustomer = () => {
    setSelectedId(''); setCreatingCustomer(true); setDraft({ id: '', name: '', phone: '', email: '', address: '', city: '', state: 'NJ', postalCode: '', notes: '', status: 'Setup', stage: 'No vehicle assigned' }); setDetailTab('customer'); setDetailTrail([]); setPaymentAction(null); setError(''); setNotice('');
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
      const result = creatingCustomer
        ? await createCustomer({ name: draft.name, phone: draft.phone, email: draft.email, address: draft.address, city: draft.city, state: draft.state, postalCode: draft.postalCode, notes: draft.notes })
        : await updateCustomer(draft.id, { expectedUpdatedAt: draft.updatedAt, phone: draft.phone, email: draft.email, address: draft.address, city: draft.city, state: draft.state, postalCode: draft.postalCode, notes: draft.notes });
      await refresh(undefined, true); setDraft(result.record); setSelectedId(result.record.id); setCreatingCustomer(false); setNotice(creatingCustomer ? 'Customer added. Assign a vehicle when the contract begins.' : 'Customer contact details updated across exact linked records.');
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setSaving(false); }
  };

  const saveAssignment = async () => {
    if (!draft || !assignmentVehicleId || !assignmentConfirmed || working) { setError('Choose the exact vehicle and confirm the assignment or swap.'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      const target = vehicles.find(row => row.id === assignmentVehicleId);
      const replacesExistingCustomer = !!(target?.currentCustomer && normalized(target.currentCustomer) !== normalized(draft.name));
      const result = await assignCustomerVehicle(draft.id, { vehicleId: assignmentVehicleId, expectedUpdatedAt: draft.updatedAt, reason: assignmentReason, replaceExistingCustomer: replacesExistingCustomer });
      await refresh(undefined, true); setDraft(result.customer); setAssignmentConfirmed(false); setNotice(result.unchanged ? 'That exact vehicle is already assigned.' : `Vehicle assignment updated across ${result.propagated.length} linked records.`);
    } catch (requestError) { setError((requestError as Error).message); await refresh(undefined, true); }
    finally { setWorking(false); }
  };

  const endCustomerContract = async () => {
    if (!draft || working || !archiveConfirmed) { setError('Confirm the exact customer and contract end date.'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      await archiveCustomer(draft.id, { expectedUpdatedAt: draft.updatedAt, contractEndedAt: new Date(archiveEndAt).toISOString(), reason: archiveReason });
      await refresh(undefined, true); closeDetail(); setFilter('history'); setNotice('Customer moved to History. The vehicle returned to In lot and all payment history was preserved.');
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
        const nextRun = scheduleValue(paymentDraft.frequency, paymentDraft.nextRun);
        if (!nextRun) throw new Error(rapidFrequency(paymentDraft.frequency) ? 'Choose the exact first charge date and time.' : 'Choose the exact first charge date.');
        const tag = vehicle.plate || vehicle.stock || vehicle.tempTag || '';
        const result = await createAutopay({ customer: draft.name || '', phone: draft.phone, email: draft.email, vehicle: vehicleTitle(vehicle), vehicleId: vehicle.id, vin: vehicle.vin, licensePlate: tag, plate: tag, tempTag: vehicle.tempTag, tracker: vehicle.tracker, amount, frequency: paymentDraft.frequency, nextRun, chargeTime: rapidFrequency(paymentDraft.frequency) ? '' : paymentDraft.chargeTime, notes: paymentDraft.note || 'Stripe setup created from the connected customer file.' });
        setGeneratedUrl(result.setupLink.url); setNotice('Stripe setup link created. No charge was made.');
      } else {
        if (!selectedSchedule) throw new Error('Choose the exact recurring plan first.');
        if (paymentAction === 'charge') {
          if (paymentDraft.chargePurpose === 'dues' && selectedDueTotal <= 0) throw new Error('This customer has no open balance to pay. Use a one-time charge instead.');
          if (paymentDraft.chargePurpose === 'dues' && amount > selectedDueTotal + 0.001) throw new Error(`The dues payment cannot exceed the current ${money(selectedDueTotal)} balance.`);
          const result = await chargeSavedCard({ recurringPaymentId: selectedSchedule.id, amount, chargePurpose: paymentDraft.chargePurpose, reason: paymentDraft.reason, note: paymentDraft.note, operationId: paymentDraft.operationId, allowAdditionalManualCharge: true });
          setNotice(paymentDraft.chargePurpose === 'dues' ? `${money(result.payment.dueAppliedAmount ?? result.payment.amount)} applied to ${draft.name}'s dues.` : `${money(result.payment.amount)} one-time charge recorded for ${result.payment.customer || draft.name}.`);
        }
        if (paymentAction === 'schedule') {
          const scheduledFor = new Date(paymentDraft.scheduledFor);
          if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) throw new Error('Choose a future date and time for the one-time payment.');
          const result = await scheduleOneTimePayment({ recurringPaymentId: selectedSchedule.id, amount, scheduledFor: scheduledFor.toISOString(), reason: paymentDraft.reason, note: paymentDraft.note, operationId: paymentDraft.operationId, confirmed: true });
          setNotice(`${money(result.scheduledPayment.amount)} will charge once on ${dateTime(result.scheduledPayment.scheduledFor)}. Autopay was not changed.`);
        }
        if (paymentAction === 'result') {
          const nextRun = paymentDraft.nextRun ? scheduleValue(paymentDraft.frequency, paymentDraft.nextRun) : '';
          const result = await recordManualPaymentResult({ recurringPaymentId: selectedSchedule.id, expectedUpdatedAt: selectedSchedule.updatedAt, operationId: paymentDraft.operationId, result: paymentDraft.result, amount, method: paymentDraft.method, nextRun, notes: paymentDraft.note });
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
          const nextRun = scheduleValue(paymentDraft.frequency, paymentDraft.nextRun);
          if (!nextRun) throw new Error(rapidFrequency(paymentDraft.frequency) ? 'Choose the exact next charge date and time.' : 'Choose the exact next charge date.');
          const updated = await updateAutopay({ recurringPaymentId: selectedSchedule.id, nextRun, frequency: paymentDraft.frequency, amount, status: paymentDraft.status, chargeTime: rapidFrequency(paymentDraft.frequency) ? '' : paymentDraft.chargeTime, retryRule: 'Retry once then contact', autopayManagedBy: selectedSchedule.autopayManagedBy || 'WheelsonAuto', note: paymentDraft.note, autoChargeEnabled: paymentDraft.autoChargeEnabled, collectionOverrideUntil: paymentDraft.collectionOverrideUntil ? new Date(paymentDraft.collectionOverrideUntil).toISOString() : '', collectionOverrideReason: paymentDraft.collectionOverrideReason, collectionSuppressLateFee: paymentDraft.collectionSuppressLateFee, collectionSuppressTow: paymentDraft.collectionSuppressTow });
          setNotice(`Autopay saved: ${updated.frequency} starting ${autopayStartText(updated.frequency, updated.nextRun, updated.chargeTime)}. Automatic charging is ${updated.autoChargeEnabled ? 'enabled' : 'off'}.`);
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

  const cancelOneTimePayment = async (row: ScheduledPaymentRecord) => {
    if (working || !window.confirm(`Cancel the ${money(row.amount)} one-time payment scheduled for ${dateTime(row.scheduledFor)}?`)) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await cancelScheduledPayment(row.id);
      await refresh(undefined, true);
      setNotice('Scheduled one-time payment cancelled. Recurring autopay was not changed.');
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setWorking(false); }
  };

  const filterSwipe = useSwipeTabs(filters, filter, setFilter);
  const availableVehicles = vehicles.filter(vehicle => !/removed|retired|sold/i.test(vehicle.status || '') && (!vehicle.currentCustomer || normalized(vehicle.currentCustomer) === normalized(draft?.name)));
  const assignmentVehicles = vehicles.filter(vehicle => !/removed|retired|sold/i.test(vehicle.status || ''));
  const assignmentTarget = assignmentVehicles.find(vehicle => vehicle.id === assignmentVehicleId);
  const replacesExistingCustomer = !!(assignmentTarget?.currentCustomer && normalized(assignmentTarget.currentCustomer) !== normalized(draft?.name));

  return <main className={`operations-workspace resource-workspace connected-customer-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index">
      <header className="workspace-title"><div><span>{filter === 'transactions' ? 'Current and historical payment ledger' : 'One connected customer record'}</span><h1>{filter === 'transactions' ? 'Transactions' : 'Customers'}</h1></div><div className="workspace-head-actions">{filter !== 'transactions' && viewed.unreadCount ? <button type="button" className="unread-summary" onClick={viewed.markAllViewed}>{viewed.unreadCount} new</button> : null}{filter !== 'transactions' ? <button type="button" className="primary-command compact" onClick={openNewCustomer}><Plus size={15} /> Add customer</button> : null}</div></header>
      <div className="customer-filter-swipe swipe-zone" {...filterSwipe}>
        <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Customer status">{filters.map(key => <button type="button" role="tab" aria-selected={filter === key} key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}><span>{filterLabels[key]}</span><strong>{counts[key]}</strong></button>)}</div>
        {filter !== 'transactions' ? <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customer, vehicle, VIN, tag" /></label> : null}
      </div>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      {filter === 'transactions' ? <Suspense fallback={<div className="workspace-loading"><span /><strong>Opening transactions</strong></div>}><CustomerTransactionsPanel payments={payments} customers={customerRows} loading={loading} onOpenCustomer={customer => { openCustomer(customer); setDetailTab('payments'); }} onOpenRental={onOpenRental} /></Suspense> : <div className="record-list">{loading ? <div className="empty-state">Loading connected customer files...</div> : null}{!loading && !visible.length ? <div className="empty-state">No customers match this view.</div> : null}{visible.map(customer => { const paymentCount = paymentCountFor(customer); const attention = paymentAttentionFor(customer); const claimCount = openClaimsFor(customer).length; const dueAmount = dueAmountFor(customer); return <button type="button" key={customer.id} className={`${customer.id === selectedId ? 'record-row active' : 'record-row'}${viewed.unreadIds.has(customer.id) ? ' unread-record' : ''}`} onClick={() => openCustomer(customer)} aria-label={`Open ${customer.name || 'customer'} file`}>{viewed.unreadIds.has(customer.id) ? <span className="record-unread-dot" aria-label="Unviewed" /> : <span className={`status-line ${filter === 'dues' ? 'warn' : statusTone(customer.status || customer.stage)}`} />}<span className="record-main"><strong>{customer.name || 'Unnamed customer'}</strong><span>{customer.vehicle || customer.email || customer.phone || 'Customer file'}</span></span><span className="record-side"><b>{filter === 'dues' ? [claimCount ? `${claimCount} toll / violation` : '', attention ? `${attention} payment issue` : ''].filter(Boolean).join(' | ') : hasAssignedVehicle(customer) ? 'Active rental' : 'History'}</b><time>{filter === 'dues' ? `${money(dueAmount)} due` : customer.nextRun ? `Due ${shortDate(customer.nextRun)}` : paymentCount ? `${paymentCount} payment record${paymentCount === 1 ? '' : 's'}` : ''}</time></span></button>; })}</div>}
    </section>

    <section className="operations-detail">{!draft ? <div className="detail-empty"><strong>Select a customer</strong><span>Customer, vehicle, card, autopay, and transaction history stay in one file.</span></div> : <div className="customer-connected-detail">
      <header className="detail-header"><button type="button" className="detail-back" onClick={backDetail}>Back</button><div><span>{creatingCustomer ? 'New customer' : 'Connected customer file'}</span><h2>{draft.name || 'Add customer'}</h2></div><em className={`status-chip ${statusTone(draft.status || draft.stage)}`}>{draft.status || draft.stage || 'Active'}</em></header>
      {error || notice ? <div className={`customer-action-feedback ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'} aria-live="polite"><span>{error || notice}</span><button type="button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={15} /></button></div> : null}
      <div className="detail-scroll">
        {detailTab === 'customer' ? <Suspense fallback={<div className="workspace-loading"><span /><strong>Opening customer file</strong></div>}>
          <CustomerProfilePanel
            customer={draft}
            creating={creatingCustomer}
            saving={saving}
            working={working}
            dueTotal={selectedDueTotal}
            nextAutopay={selectedSchedule?.nextRun}
            vehicles={assignmentVehicles}
            assignmentVehicleId={assignmentVehicleId}
            assignmentReason={assignmentReason}
            assignmentConfirmed={assignmentConfirmed}
            assignmentTarget={assignmentTarget}
            replacesExistingCustomer={replacesExistingCustomer}
            archiveEndAt={archiveEndAt}
            archiveReason={archiveReason}
            archiveConfirmed={archiveConfirmed}
            onChange={setDraft}
            onSubmit={submitCustomer}
            onOpenRental={onOpenRental}
            onMessages={() => onNavigate('messages')}
            onPayments={() => navigateDetail('payments')}
            onDues={() => navigateDetail('dues')}
            onAssignmentVehicle={vehicleId => { setAssignmentVehicleId(vehicleId); setAssignmentConfirmed(false); }}
            onAssignmentReason={setAssignmentReason}
            onAssignmentConfirmed={setAssignmentConfirmed}
            onSaveAssignment={saveAssignment}
            onArchiveEnd={value => { setArchiveEndAt(value); setArchiveConfirmed(false); }}
            onArchiveReason={setArchiveReason}
            onArchiveConfirmed={setArchiveConfirmed}
            onEndContract={endCustomerContract}
          />
        </Suspense> : detailTab === 'payments' ? <section className="customer-payments-detail">
          <header className="payment-detail-command"><div><span>Payment control</span><strong>{selectedSchedule ? `${money(selectedSchedule.amount)} ${selectedSchedule.frequency || 'Weekly'}` : 'No recurring plan yet'}</strong><small>{selectedSchedule ? completedAutopay(selectedSchedule) ? `${selectedSchedule.provider || selectedSchedule.paymentProvider || 'Provider'} | Test completed` : `${selectedSchedule.provider || selectedSchedule.paymentProvider || 'Provider'} | Next ${scheduleText(selectedSchedule.nextRun)}` : 'Create a secure Stripe setup link to begin.'}</small></div><div className="customer-file-commands"><button type="button" className="secondary-command compact" onClick={() => navigateDetail('customer')}><FileText size={15} /> Customer info</button><button type="button" className="secondary-command compact" onClick={() => navigateDetail('dues')}><CircleDollarSign size={15} /> Dues</button><button type="button" className="primary-command compact" onClick={() => beginAction('new')}><Plus size={15} /> Add autopay</button></div></header>
          {selectedCustomerAutopay.length > 1 ? <label className="schedule-picker">Recurring plan<select value={selectedSchedule?.id || ''} onChange={event => { setSelectedAutopayId(event.target.value); setPaymentAction(null); }} >{selectedCustomerAutopay.map(row => <option key={row.id} value={row.id}>{[money(row.amount), row.frequency || 'Weekly', row.vehicle || 'No vehicle', row.status || 'Setup'].join(' | ')}</option>)}</select></label> : null}
          {selectedSchedule ? <><section className="payment-schedule-summary"><div><span>Status</span><strong>{selectedSchedule.status || 'Setup needed'}</strong></div><div><span>Card</span><strong>{cardDisplay(selectedSchedule)}</strong></div><div><span>Autocharge</span><strong>{completedAutopay(selectedSchedule) ? 'Legacy test complete' : selectedSchedule.autoChargeEnabled ? 'Enabled' : 'Not enabled'}</strong></div><div><span>Next attempt</span><strong>{completedAutopay(selectedSchedule) ? 'Edit to resume' : scheduleText(selectedSchedule.autopayNextAttemptAt || selectedSchedule.nextRun)}</strong></div><div><span>Vehicle</span><strong>{selectedSchedule.vehicle || 'Not linked'}</strong></div><div><span>Collections</span><strong>{selectedSchedule.collectionStatus || 'Current schedule'}</strong><small>{selectedSchedule.collectionRemainingAmount ? `${money(selectedSchedule.collectionRemainingAmount)} remaining · ${selectedSchedule.collectionPaidPercent || 0}% paid` : selectedSchedule.collectionOverrideUntil ? `Override until ${dateTime(selectedSchedule.collectionOverrideUntil)}` : 'No overdue collection action'}</small></div></section>{!completedAutopay(selectedSchedule) && selectedSchedule.autoChargeEnabled && selectedSchedule.autopayBlockedReason && !/^Waiting for/i.test(selectedSchedule.autopayBlockedReason) ? <div className="inline-alert error"><strong>Autopay is blocked.</strong> {selectedSchedule.autopayBlockedReason}</div> : null}<div className="payment-command-row"><button type="button" className="primary-command compact" onClick={() => beginAction('charge')}><CircleDollarSign size={15} /> Charge</button><button type="button" className="secondary-command compact" onClick={() => beginAction('schedule')}><CalendarClock size={15} /> Schedule once</button><button type="button" className="secondary-command compact" onClick={() => beginAction('result')}><WalletCards size={15} /> Record result</button><button type="button" className="secondary-command compact" onClick={() => beginAction('link')}><Send size={15} /> Send link</button><button type="button" className="text-command" onClick={() => beginAction('card')}><CreditCard size={15} /> Change card</button><button type="button" className="text-command" onClick={() => beginAction('edit')}><CalendarClock size={15} /> Edit autopay</button>{/setup|waiting/i.test([selectedSchedule.status, selectedSchedule.paymentSetup].join(' ')) ? <button type="button" className="danger-text-command" onClick={() => beginAction('delete')}><Trash2 size={15} /> Delete setup</button> : <button type="button" className="danger-text-command" onClick={() => beginAction('remove')}><Trash2 size={15} /> Remove autopay</button>}</div></> : null}
          {paymentAction && paymentDraft ? <Suspense fallback={<div className="workspace-loading"><span /><strong>Opening payment action</strong></div>}><CustomerPaymentActionPanel action={paymentAction} draft={paymentDraft} customer={draft} selectedSchedule={selectedSchedule} availableVehicles={availableVehicles} dueTotal={selectedDueTotal} working={working} generatedUrl={generatedUrl} onDraft={setPaymentDraft} onSubmit={runPaymentAction} onClose={() => { setPaymentAction(null); setPaymentDraft(null); setGeneratedUrl(''); }} onCopy={copyGeneratedUrl} /></Suspense> : null}
          {selectedScheduledPayments.length ? <section className="transaction-history scheduled-payment-history"><header><div><span>One-time scheduler</span><strong>Scheduled payments</strong></div><b>{selectedScheduledPayments.length}</b></header>{selectedScheduledPayments.slice(0, 10).map(row => <article key={row.id}><span className={`status-line ${statusTone(row.status)}`} /><div><strong>{money(row.amount)} | {row.status}</strong><small>{[dateTime(row.scheduledFor), row.reason, row.cardLast4 ? `Card ending ${row.cardLast4}` : row.provider].filter(Boolean).join(' | ')}</small>{row.lastError ? <small>{row.lastError}</small> : null}</div>{/^scheduled$/i.test(row.status) ? <button type="button" className="danger-text-command" disabled={working} onClick={() => void cancelOneTimePayment(row)}>Cancel</button> : null}</article>)}</section> : null}
          <section className="transaction-history"><header><div><span>History</span><strong>Transactions</strong></div><b>{selectedCustomerPayments.length}</b></header>{selectedCustomerPayments.length ? selectedCustomerPayments.map(payment => <article key={payment.id}><span className={`status-line ${statusTone(payment.status)}`} /><div><strong>{money(payment.amount)} | {payment.status || 'Recorded'}</strong><small>{[payment.vehicle, payment.method || payment.provider, dateTime(payment.createdAt || payment.date)].filter(Boolean).join(' | ')}</small></div>{payment.rentalFileId ? <button type="button" className="text-command" onClick={() => onOpenRental(payment.rentalFileId || '')}><FileText size={14} /> File</button> : null}</article>) : <div className="empty-state compact">No transactions are connected to this customer yet.</div>}</section>
        </section> : <Suspense fallback={<div className="workspace-loading"><span /><strong>Opening dues</strong></div>}>
          <CustomerDuesPanel
            customer={draft}
            claims={selectedOpenClaims}
            failedPayments={selectedFailedPayments}
            dueTotal={selectedDueTotal}
            onBack={() => navigateDetail('customer')}
            onPayments={() => navigateDetail('payments')}
            onOpenRental={onOpenRental}
            onRefresh={() => refresh(undefined, true)}
            onError={setError}
            onNotice={setNotice}
          />
        </Suspense>}
      </div>
    </div>}</section>
  </main>;
}
