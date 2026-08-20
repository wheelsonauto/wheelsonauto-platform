import type { FormEvent } from 'react';
import { CarFront, CircleDollarSign, FileText, MessageSquareText, Trash2, WalletCards } from 'lucide-react';
import type { CustomerRecord, VehicleRecord } from '../types';
import { dateTime, money, shortDate } from '../ui';

function vehicleTitle(vehicle: VehicleRecord) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vin || 'Unnamed vehicle';
}

export function CustomerProfilePanel({
  customer,
  creating,
  saving,
  working,
  dueTotal,
  vehicles,
  assignmentVehicleId,
  assignmentReason,
  assignmentConfirmed,
  assignmentTarget,
  replacesExistingCustomer,
  archiveEndAt,
  archiveReason,
  archiveConfirmed,
  onChange,
  onSubmit,
  onOpenRental,
  onMessages,
  onPayments,
  onDues,
  onAssignmentVehicle,
  onAssignmentReason,
  onAssignmentConfirmed,
  onSaveAssignment,
  onArchiveEnd,
  onArchiveReason,
  onArchiveConfirmed,
  onEndContract
}: {
  customer: CustomerRecord;
  creating: boolean;
  saving: boolean;
  working: boolean;
  dueTotal: number;
  vehicles: VehicleRecord[];
  assignmentVehicleId: string;
  assignmentReason: string;
  assignmentConfirmed: boolean;
  assignmentTarget?: VehicleRecord;
  replacesExistingCustomer: boolean;
  archiveEndAt: string;
  archiveReason: string;
  archiveConfirmed: boolean;
  onChange: (customer: CustomerRecord) => void;
  onSubmit: (event: FormEvent) => void;
  onOpenRental: (rentalId: string) => void;
  onMessages: () => void;
  onPayments: () => void;
  onDues: () => void;
  onAssignmentVehicle: (vehicleId: string) => void;
  onAssignmentReason: (reason: string) => void;
  onAssignmentConfirmed: (confirmed: boolean) => void;
  onSaveAssignment: () => void;
  onArchiveEnd: (value: string) => void;
  onArchiveReason: (reason: string) => void;
  onArchiveConfirmed: (confirmed: boolean) => void;
  onEndContract: () => void;
}) {
  return <form id="connected-customer-form" onSubmit={onSubmit}>
    {!creating ? <>
      <section className="identity-summary customer-lifecycle-summary">
        <div><span>Vehicle</span><strong>{customer.vehicle || 'Not assigned'}</strong></div>
        <div><span>Amount due</span><strong>{money(dueTotal)}</strong></div>
        <div><span>Contract start</span><strong>{customer.contractStartedAt ? shortDate(customer.contractStartedAt) : 'Not recorded'}</strong></div>
        <div><span>Contract end</span><strong>{customer.contractEndedAt || customer.endDate ? dateTime(customer.contractEndedAt || customer.endDate) : 'Active'}</strong></div>
      </section>
      <div className="context-actions">
        {customer.activeRentalFileId ? <button type="button" className="primary-command compact" onClick={() => onOpenRental(customer.activeRentalFileId || '')}><FileText size={15} /> Rental File</button> : null}
        {customer.signedAgreementUrl ? <a className="text-command" href={customer.signedAgreementUrl}><FileText size={15} /> Signed contract</a> : null}
        <button type="button" className="text-command" onClick={onMessages}><MessageSquareText size={15} /> Messages</button>
        <button type="button" className="text-command" onClick={onPayments}><WalletCards size={15} /> Payments</button>
        <button type="button" className="text-command" onClick={onDues}><CircleDollarSign size={15} /> Dues {dueTotal ? money(dueTotal) : ''}</button>
      </div>
    </> : null}

    <div className="form-grid">
      {creating ? <label className="span-2">Customer name<input required value={customer.name || ''} onChange={event => onChange({ ...customer, name: event.target.value })} /></label> : null}
      <label>Phone<input value={customer.phone || ''} onChange={event => onChange({ ...customer, phone: event.target.value })} /></label>
      <label>Email<input type="email" value={customer.email || ''} onChange={event => onChange({ ...customer, email: event.target.value })} /></label>
      <label className="span-2">Address<input value={customer.address || ''} onChange={event => onChange({ ...customer, address: event.target.value })} /></label>
      <label>City<input value={customer.city || ''} onChange={event => onChange({ ...customer, city: event.target.value })} /></label>
      <label>State<input value={customer.state || ''} onChange={event => onChange({ ...customer, state: event.target.value })} /></label>
      <label>Postal code<input value={customer.postalCode || ''} onChange={event => onChange({ ...customer, postalCode: event.target.value })} /></label>
      {!creating ? <label>VIN<input readOnly value={customer.vin || ''} /></label> : null}
      <label className="span-2">Notes<textarea rows={4} value={customer.notes || ''} onChange={event => onChange({ ...customer, notes: event.target.value })} /></label>
    </div>
    <button className="primary-command" disabled={saving || !customer.name?.trim()}>{saving ? 'Saving...' : creating ? 'Add customer' : 'Save customer details'}</button>

    {!creating ? <>
      <section className="assignment-editor">
        <header><div><span>Fleet connection</span><strong>{customer.vehicleId ? 'Swap assigned vehicle' : 'Assign a vehicle'}</strong></div><CarFront size={19} /></header>
        <label>Exact vehicle<select value={assignmentVehicleId} onChange={event => onAssignmentVehicle(event.target.value)}><option value="">Choose vehicle</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{[vehicleTitle(vehicle), vehicle.vin && `VIN ${vehicle.vin}`, vehicle.plate || vehicle.stock, vehicle.status, vehicle.currentCustomer && `Renter: ${vehicle.currentCustomer}`].filter(Boolean).join(' | ')}</option>)}</select></label>
        {replacesExistingCustomer ? <div className="inline-alert error"><strong>{assignmentTarget?.currentCustomer} currently has this car.</strong> Saving will end that customer contract, move them to History, stop their linked autopay, and assign the car to {customer.name}.</div> : null}
        <label>Reason<input value={assignmentReason} onChange={event => onAssignmentReason(event.target.value)} /></label>
        <label className="sensitive-confirmation"><input type="checkbox" checked={assignmentConfirmed} onChange={event => onAssignmentConfirmed(event.target.checked)} /><span><strong>I confirmed the customer and exact vehicle.</strong><small>{replacesExistingCustomer ? 'I also confirmed the current renter must be ended and moved to History.' : 'A swap returns the old car to In lot and updates the Rental File, payments, and history.'}</small></span></label>
        <button type="button" className={replacesExistingCustomer ? 'danger-command' : 'secondary-command'} disabled={working || !assignmentConfirmed || !assignmentVehicleId} onClick={onSaveAssignment}>{working ? 'Updating...' : replacesExistingCustomer ? 'End prior contract and reassign' : 'Save vehicle assignment'}</button>
      </section>
      <section className="assignment-editor customer-history-control">
        <header><div><span>Customer history</span><strong>End contract and return vehicle</strong></div><Trash2 size={19} /></header>
        <div className="form-grid compact-action-form"><label>Contract ended at<input type="datetime-local" value={archiveEndAt} onChange={event => onArchiveEnd(event.target.value)} /></label><label>Reason<input value={archiveReason} onChange={event => onArchiveReason(event.target.value)} /></label></div>
        <label className="sensitive-confirmation"><input type="checkbox" checked={archiveConfirmed} onChange={event => onArchiveConfirmed(event.target.checked)} /><span><strong>Move {customer.name} to History.</strong><small>The car returns to In lot. Autopay stops, but dues, payments, dates, and the signed contract stay saved.</small></span></label>
        <button type="button" className="danger-command" disabled={working || !archiveConfirmed || !archiveEndAt} onClick={onEndContract}>End customer contract</button>
      </section>
    </> : null}
  </form>;
}
