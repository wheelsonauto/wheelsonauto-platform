import { type FormEvent } from 'react';
import { Copy, ExternalLink, FileText } from 'lucide-react';
import type { CustomerRecord, RecurringPaymentRecord, VehicleRecord } from '../types';
import { money } from '../ui';

export type PaymentAction = 'new' | 'charge' | 'schedule' | 'result' | 'link' | 'card' | 'edit' | 'remove' | 'delete' | null;
export type ActionDraft = {
  amount: string;
  frequency: string;
  nextRun: string;
  chargeTime: string;
  scheduledFor: string;
  status: string;
  result: string;
  method: string;
  reason: string;
  chargePurpose: 'one_time' | 'dues';
  note: string;
  provider: 'stripe' | 'clover';
  vehicleId: string;
  autoChargeEnabled: boolean;
  emailLink: boolean;
  confirmed: boolean;
  operationId: string;
};

function rapidFrequency(value?: string) { return /every (minute|hour)/i.test(String(value || '')); }
function dateInput(value?: string) { return String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || ''; }
function nextRapidInput(frequency: string) {
  const date = new Date(Date.now() + (/hour/i.test(frequency) ? 60 : 1) * 60_000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function vehicleTitle(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vin || 'Unnamed vehicle';
}

export function CustomerPaymentActionPanel({ action, draft, customer, selectedSchedule, availableVehicles, dueTotal, working, generatedUrl, onDraft, onSubmit, onClose, onCopy }: {
  action: Exclude<PaymentAction, null>;
  draft: ActionDraft;
  customer: CustomerRecord;
  selectedSchedule: RecurringPaymentRecord | null;
  availableVehicles: VehicleRecord[];
  dueTotal: number;
  working: boolean;
  generatedUrl: string;
  onDraft: (draft: ActionDraft) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onCopy: () => void;
}) {
  const setupAction = action === 'new' || action === 'card';
  const title = action === 'new' ? 'Add autopay' : action === 'charge' ? 'Charge saved card' : action === 'schedule' ? 'Schedule one-time payment' : action === 'result' ? 'Record payment result' : action === 'link' ? 'Send payment link' : action === 'card' ? 'Change card on file' : action === 'edit' ? 'Edit autopay' : action === 'delete' ? 'Delete pending setup' : 'Remove autopay';
  return <form className="payment-action-sheet" onSubmit={onSubmit}>
    <header><div><span>Admin confirmation</span><strong>{title}</strong></div><button type="button" className="text-command" onClick={onClose}>Close</button></header>
    {generatedUrl ? <section className="generated-link"><span>Secure link ready</span><input value={generatedUrl} readOnly /><div><button type="button" className="secondary-command compact" onClick={onCopy}><Copy size={14} /> Copy</button><a className="primary-command compact" href={generatedUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a></div></section> : null}
    {!generatedUrl ? <div className="form-grid compact-action-form">
      {action === 'new' ? <label className="span-2">Exact vehicle<select required value={draft.vehicleId} onChange={event => onDraft({ ...draft, vehicleId: event.target.value })}><option value="">Choose vehicle</option>{availableVehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{[vehicleTitle(vehicle), vehicle.vin && `VIN ${vehicle.vin}`, vehicle.plate || vehicle.stock, vehicle.status].filter(Boolean).join(' | ')}</option>)}</select></label> : null}
      {!['remove', 'delete', 'card'].includes(action) ? <label>Amount<input type="number" min="0.01" step="0.01" value={draft.amount} onChange={event => onDraft({ ...draft, amount: event.target.value })} /></label> : null}
      {action === 'charge' ? <><label>Charge type<select value={draft.chargePurpose} onChange={event => onDraft({ ...draft, chargePurpose: event.target.value as 'one_time' | 'dues' })}><option value="one_time">One-time charge</option><option value="dues">Apply payment to dues</option></select></label><label>{draft.chargePurpose === 'dues' ? `Open balance (${money(dueTotal)})` : 'Optional reason'}<input value={draft.reason} onChange={event => onDraft({ ...draft, reason: event.target.value })} placeholder={draft.chargePurpose === 'dues' ? 'Applied to open dues' : 'Example: replacement key'} /></label><div className="rapid-schedule-note span-2"><strong>Owner override</strong><span>This charge is separate from autopay. Earlier paid transactions stay visible as a warning, but they do not block this confirmed one-time charge.</span></div></> : null}
      {action === 'schedule' ? <><label>Charge date and time<input required type="datetime-local" step="60" value={draft.scheduledFor} onChange={event => onDraft({ ...draft, scheduledFor: event.target.value })} /></label><label>Reason<input value={draft.reason} onChange={event => onDraft({ ...draft, reason: event.target.value })} placeholder="Optional reason shown on the receipt" /></label><div className="rapid-schedule-note span-2"><strong>One charge only</strong><span>WheelsonAuto will attempt this Stripe charge once at the selected time. It will not change or advance the recurring autopay schedule.</span></div></> : null}
      {action === 'result' ? <><label>Result<select value={draft.result} onChange={event => onDraft({ ...draft, result: event.target.value })}><option>Paid</option><option>Pending</option><option>1x failed - retrying</option><option>2x failed - contact customer</option><option>Payment not found - check provider</option></select></label><label>Method<select value={draft.method} onChange={event => onDraft({ ...draft, method: event.target.value })}><option>Paid outside app</option><option>Stripe manual charge</option><option>Clover manual charge</option><option>Cash</option><option>Other</option></select></label></> : null}
      {action === 'link' ? <label>Reason<select value={draft.reason} onChange={event => onDraft({ ...draft, reason: event.target.value })}><option>Payment needs attention</option><option>Catch-up payment</option><option>One-time payment</option><option>Partial payment</option></select></label> : null}
      {action === 'card' ? <label>Secure provider<select value={draft.provider} onChange={event => onDraft({ ...draft, provider: event.target.value as 'stripe' | 'clover' })}><option value="stripe">Stripe</option><option value="clover">Clover</option></select></label> : null}
      {['new', 'edit'].includes(action) ? <><label>Frequency<select value={draft.frequency} onChange={event => { const frequency = event.target.value; const rapid = rapidFrequency(frequency); onDraft({ ...draft, frequency, nextRun: rapid ? nextRapidInput(frequency) : dateInput(draft.nextRun) || dateInput(new Date().toISOString()), chargeTime: rapid ? '' : draft.chargeTime || '18:00' }); }}><option>Every minute</option><option>Every hour</option><option>Daily</option><option>Weekly</option><option>Bi-weekly</option><option>Semi-monthly</option><option>Monthly</option></select></label>{!rapidFrequency(draft.frequency) ? <label>Charge time<input type="time" value={draft.chargeTime} onChange={event => onDraft({ ...draft, chargeTime: event.target.value })} /></label> : <div className="rapid-schedule-note"><strong>Rapid recurring schedule</strong><span>This makes a real saved-card charge every selected interval until automatic charging is turned off. Each occurrence receives its own payment and next-charge record.</span></div>}</> : null}
      {['new', 'result', 'edit'].includes(action) ? <label>{rapidFrequency(draft.frequency) ? 'Next charge date and time' : 'Next charge date'}<input type={rapidFrequency(draft.frequency) ? 'datetime-local' : 'date'} step={rapidFrequency(draft.frequency) ? '60' : undefined} value={draft.nextRun} onChange={event => onDraft({ ...draft, nextRun: event.target.value })} /></label> : null}
      {action === 'edit' ? <><label>Status<select value={draft.status} onChange={event => onDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Pending</option><option>1x failed - retrying</option><option>2x failed - contact customer</option><option>Paused</option></select></label><label className="toggle-field"><input type="checkbox" checked={draft.autoChargeEnabled} onChange={event => onDraft({ ...draft, autoChargeEnabled: event.target.checked })} /> Automatic charging enabled</label></> : null}
      <label className="span-2">Internal note<textarea rows={3} value={draft.note} onChange={event => onDraft({ ...draft, note: event.target.value })} placeholder={action === 'remove' ? 'Why autopay is being removed' : 'Optional receipt, schedule, or customer context'} /></label>
      {setupAction || action === 'link' ? <label className="toggle-field span-2"><input type="checkbox" checked={draft.emailLink} disabled={!customer.email} onChange={event => onDraft({ ...draft, emailLink: event.target.checked })} /> Email the secure link to {customer.email || 'customer email not saved'}</label> : null}
    </div> : null}
    {!generatedUrl ? <><label className="sensitive-confirmation"><input type="checkbox" checked={draft.confirmed} onChange={event => onDraft({ ...draft, confirmed: event.target.checked })} /><span><strong>I confirmed {customer.name || 'this customer'} and this exact action.</strong><small>{action === 'charge' ? `This immediately attempts a real ${selectedSchedule?.provider || selectedSchedule?.paymentProvider || 'saved-card'} charge, even when an earlier payment is already recorded.` : action === 'schedule' ? 'This authorizes one real Stripe charge at the displayed date and time without changing autopay.' : action === 'remove' || action === 'delete' ? 'This changes active payment setup, but keeps the customer and history.' : 'WheelsonAuto will save a trackable record of this action.'}</small></span></label><button className={action === 'remove' || action === 'delete' ? 'danger-command full-command' : 'primary-command full-command'} disabled={working || !draft.confirmed}>{working ? 'Working...' : action === 'charge' ? 'Charge saved card now' : action === 'schedule' ? 'Schedule one-time payment' : action === 'result' ? 'Save payment result' : action === 'link' ? 'Create and send link' : action === 'card' ? 'Create card setup link' : action === 'edit' ? 'Save autopay' : action === 'remove' ? 'Remove autopay' : action === 'delete' ? 'Delete setup' : 'Create Stripe setup link'}</button></> : null}
  </form>;
}
