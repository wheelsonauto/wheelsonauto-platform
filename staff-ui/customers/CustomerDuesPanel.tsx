import { type ChangeEvent, type FormEvent, useState } from 'react';
import { CircleDollarSign, FileText, Plus, Trash2, WalletCards } from 'lucide-react';
import { archiveClaim, createClaim } from '../api';
import type { ClaimRecord, CustomerRecord, PaymentRecord } from '../types';
import { dateTime, money, shortDate } from '../ui';

type DueDraft = { type: string; amount: string; due: string; incidentDate: string; reference: string; notes: string; proof: File | null; confirmed: boolean };
const newDueDraft = (): DueDraft => ({ type: 'Toll', amount: '', due: '', incidentDate: '', reference: '', notes: '', proof: null, confirmed: false });

async function dueProof(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('The proof file could not be read.')); reader.readAsDataURL(file); });
  return { name: file.name, type: file.type, size: file.size, dataUrl };
}

export function CustomerDuesPanel({ customer, claims, failedPayments, dueTotal, onBack, onPayments, onOpenRental, onRefresh, onError, onNotice }: {
  customer: CustomerRecord;
  claims: ClaimRecord[];
  failedPayments: PaymentRecord[];
  dueTotal: number;
  onBack: () => void;
  onPayments: () => void;
  onOpenRental: (rentalId: string) => void;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DueDraft>(newDueDraft());
  const [working, setWorking] = useState(false);

  const chooseProof = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    if (!/^(?:image\/(?:jpeg|png)|application\/pdf)$/i.test(file.type) || file.size > 8 * 1024 * 1024) { onError('Proof must be a JPG, PNG, or PDF no larger than 8 MB.'); return; }
    setDraft(current => ({ ...current, proof: file })); onError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (working || !draft.confirmed) { onError('Confirm the exact customer and amount first.'); return; }
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { onError('Enter an amount greater than zero.'); return; }
    setWorking(true); onError(''); onNotice('');
    try {
      await createClaim({ customerId: customer.id, vehicleId: customer.vehicleId, type: draft.type, amount, due: draft.due, incidentDate: draft.incidentDate, reference: draft.reference, notes: draft.notes, file: draft.proof ? await dueProof(draft.proof) : undefined });
      await onRefresh(); setAdding(false); setDraft(newDueDraft()); onNotice(`${draft.type} added to ${customer.name}'s amount due.`);
    } catch (requestError) { onError((requestError as Error).message); await onRefresh(); }
    finally { setWorking(false); }
  };

  const remove = async (claim: ClaimRecord) => {
    if (working || !window.confirm(`Remove the ${claim.type || 'due'} for ${customer.name || 'this customer'}? The audit history will stay saved.`)) return;
    setWorking(true); onError(''); onNotice('');
    try { await archiveClaim(claim.id, claim.updatedAt, 'Removed from the customer balance by staff.'); await onRefresh(); onNotice('Due removed from the active balance. History was preserved.'); }
    catch (requestError) { onError((requestError as Error).message); await onRefresh(); }
    finally { setWorking(false); }
  };

  return <section className="customer-dues-detail"><header className="payment-detail-command"><div><span>Tolls, violations, fees, and unpaid amounts</span><strong>{money(dueTotal)} due</strong><small>{claims.length} staff-added item{claims.length === 1 ? '' : 's'} | {failedPayments.length} failed or unpaid payment{failedPayments.length === 1 ? '' : 's'}</small></div><div className="customer-file-commands"><button type="button" className="secondary-command compact" onClick={onBack}><FileText size={15} /> Customer</button><button type="button" className="secondary-command compact" onClick={onPayments}><WalletCards size={15} /> Payments</button><button type="button" className="primary-command compact" onClick={() => setAdding(value => !value)}><Plus size={15} /> Add due</button></div></header>
    {adding ? <form className="payment-action-sheet" onSubmit={save}><header><div><span>New amount due</span><strong>Add exact proof and amount</strong></div><button type="button" className="text-command" onClick={() => { setAdding(false); setDraft(newDueDraft()); }}>Close</button></header><div className="form-grid compact-action-form"><label>Type<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}><option>Toll</option><option>Violation / ticket</option><option>Late fee</option><option>Unpaid payment</option><option>Damage / repair</option><option>Other due</option></select></label><label>Amount<input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label><label>Incident date<input type="date" value={draft.incidentDate} onChange={event => setDraft({ ...draft, incidentDate: event.target.value })} /></label><label>Due date<input type="date" value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })} /></label><label className="span-2">Reference<input value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} placeholder="Ticket, toll, or invoice number" /></label><label className="span-2">Notes<textarea rows={3} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label><div className="span-2 due-proof-picker"><label className="secondary-command"><FileText size={15} /> Attach proof<input hidden type="file" accept="image/jpeg,image/png,application/pdf" onChange={chooseProof} /></label><span>{draft.proof?.name || 'Optional JPG, PNG, or PDF'}</span></div></div><label className="sensitive-confirmation"><input type="checkbox" checked={draft.confirmed} onChange={event => setDraft({ ...draft, confirmed: event.target.checked })} /><span><strong>I confirmed {customer.name} and this exact amount.</strong><small>The item becomes part of the customer balance and audit history.</small></span></label><button className="primary-command full-command" disabled={working || !draft.confirmed}>{working ? 'Saving...' : 'Add to amount due'}</button></form> : null}
    <section className="transaction-history"><header><div><span>Open balance</span><strong>Staff-added dues</strong></div><b>{claims.length}</b></header>{claims.length ? claims.map(claim => <article key={claim.id}><span className="status-line warn" /><div><strong>{money(claim.remainingAmount ?? claim.amount)} | {claim.type || 'Due'}</strong><small>{[claim.amountPaid ? `${money(claim.amountPaid)} paid` : '', claim.incidentDate && `Incident ${shortDate(claim.incidentDate)}`, claim.due && `Due ${shortDate(claim.due)}`, claim.reference, claim.notes].filter(Boolean).join(' | ')}</small></div><div className="row-actions">{claim.proofUrl ? <a className="text-command" href={claim.proofUrl}><FileText size={14} /> Proof</a> : null}<button type="button" className="danger-text-command" disabled={working} onClick={() => remove(claim)}><Trash2 size={14} /> Remove</button></div></article>) : <div className="empty-state compact">No staff-added dues are open.</div>}</section>
    <section className="transaction-history"><header><div><span>Payment exceptions</span><strong>Failed or unpaid transactions</strong></div><b>{failedPayments.length}</b></header>{failedPayments.length ? failedPayments.map(payment => <article key={payment.id}><span className="status-line warn" /><div><strong>{money(payment.balanceRemaining ?? payment.amount)} | {payment.status}</strong><small>{[payment.vehicle, payment.method || payment.provider, dateTime(payment.createdAt || payment.date)].filter(Boolean).join(' | ')}</small></div>{payment.rentalFileId ? <button type="button" className="text-command" onClick={() => onOpenRental(payment.rentalFileId || '')}>File</button> : null}</article>) : <div className="empty-state compact">No failed or unpaid transactions.</div>}</section>
    {customer.signedAgreementUrl ? <div className="context-actions"><a className="secondary-command" href={customer.signedAgreementUrl}><FileText size={15} /> View signed contract</a></div> : null}
  </section>;
}
