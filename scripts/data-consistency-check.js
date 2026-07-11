const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.join(root, 'seed.json');
const data = JSON.parse(fs.readFileSync(target, 'utf8'));

const errors = [];
const warnings = [];

function rows(name) {
  return Array.isArray(data[name]) ? data[name] : [];
}

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function vehicleName(vehicle) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.name || '';
}

function isRemoved(value) {
  return /removed|ended|closed|history/i.test(String(value || ''));
}

function isReadyVehicle(vehicle) {
  const status = String(vehicle.status || '').toLowerCase();
  return !norm(vehicle.currentCustomer) && ['ready', 'available', 'coming soon', 'pending application'].includes(status);
}

function weakCustomerName(value) {
  return !norm(value) || /^(unknown|unmatched|customer match needed|customer|n\/a|na)$/i.test(String(value || '').trim());
}

function add(collection, message, detail) {
  collection.push(detail ? `${message}: ${detail}` : message);
}

function checkDuplicateIds(name) {
  const seen = new Map();
  rows(name).forEach((row, index) => {
    const id = String(row && row.id || '').trim();
    if (!id) return add(errors, `${name}[${index}] is missing id`);
    if (seen.has(id)) add(errors, `${name} has duplicate id`, id);
    seen.set(id, true);
  });
}

['vehicles', 'customers', 'contracts', 'recurringPayments', 'payments', 'maintenance', 'claims', 'messages', 'applications'].forEach(checkDuplicateIds);

const vehicles = rows('vehicles');
const customers = rows('customers');
const contracts = rows('contracts');
const recurring = rows('recurringPayments');
const payments = rows('payments');
const maintenance = rows('maintenance');

const vehicleById = new Map(vehicles.map(vehicle => [String(vehicle.id || ''), vehicle]).filter(([id]) => id));
const vehicleByName = new Map();
vehicles.forEach(vehicle => {
  const key = norm(vehicleName(vehicle));
  if (key && !vehicleByName.has(key)) vehicleByName.set(key, vehicle);
});

const people = new Set();
customers.forEach(customer => {
  if (!weakCustomerName(customer.name || customer.customer)) people.add(norm(customer.name || customer.customer));
});
contracts.forEach(contract => {
  if (!weakCustomerName(contract.customer)) people.add(norm(contract.customer));
});
recurring.forEach(row => {
  if (!weakCustomerName(row.customer)) people.add(norm(row.customer));
});

vehicles.forEach(vehicle => {
  const name = vehicleName(vehicle) || vehicle.id || 'Unknown vehicle';
  const customer = String(vehicle.currentCustomer || '').trim();
  if (isReadyVehicle(vehicle) && customer) add(errors, 'Ready/available vehicle still has a current customer', `${name} -> ${customer}`);
  if (customer && !people.has(norm(customer))) add(warnings, 'Vehicle customer is not linked to a customer/autopay/file record', `${name} -> ${customer}`);
  if (!String(vehicle.vin || '').trim()) add(warnings, 'Vehicle is missing VIN', name);
  if (!String(vehicle.plate || vehicle.stock || '').trim()) add(warnings, 'Vehicle is missing tag/plate/stock', name);
});

recurring.forEach(row => {
  const label = row.customer || row.id || 'Unknown recurring row';
  const active = !isRemoved(row.status);
  if (active && weakCustomerName(row.customer)) add(errors, 'Active recurring row is missing customer name', row.id || '');
  if (active && Number(row.amount || row.weeklyAmount || 0) <= 0) add(errors, 'Active recurring row is missing amount', label);
  if (row.vehicleId && !vehicleById.has(String(row.vehicleId))) add(errors, 'Recurring row points to missing vehicle id', `${label} -> ${row.vehicleId}`);
  if (!row.vehicleId && row.vehicle && !vehicleByName.has(norm(row.vehicle))) add(warnings, 'Recurring row vehicle text does not match fleet', `${label} -> ${row.vehicle}`);
  if (active && !String(row.nextRun || row.adminNextRun || '').trim()) add(warnings, 'Active recurring row is missing next charge date', label);
});

customers.forEach(customer => {
  const label = customer.name || customer.customer || customer.id || 'Unknown customer';
  if (weakCustomerName(label)) add(errors, 'Customer row is missing name', customer.id || '');
  if (customer.vehicleId && !vehicleById.has(String(customer.vehicleId))) add(errors, 'Customer points to missing vehicle id', `${label} -> ${customer.vehicleId}`);
  if (!customer.vehicleId && customer.vehicle && !vehicleByName.has(norm(customer.vehicle))) add(warnings, 'Customer vehicle text does not match fleet', `${label} -> ${customer.vehicle}`);
});

contracts.forEach(contract => {
  const label = contract.customer || contract.id || 'Unknown customer file';
  if (!isRemoved(contract.status) && weakCustomerName(contract.customer)) add(errors, 'Active customer file is missing customer name', contract.id || '');
  if (contract.vehicleId && !vehicleById.has(String(contract.vehicleId))) add(errors, 'Customer file points to missing vehicle id', `${label} -> ${contract.vehicleId}`);
  if (!contract.vehicleId && contract.vehicle && !vehicleByName.has(norm(contract.vehicle))) add(warnings, 'Customer file vehicle text does not match fleet', `${label} -> ${contract.vehicle}`);
});

payments.forEach(payment => {
  const label = payment.id || `${payment.date || 'undated'} ${payment.amount || ''}`;
  if (weakCustomerName(payment.customer) && Number(payment.amount || 0) !== 0) {
    add(errors, 'Payment is missing a usable customer name', label);
  }
  if (payment.recurringPaymentId && !recurring.some(row => row.id === payment.recurringPaymentId)) {
    add(errors, 'Payment points to missing recurring row', `${label} -> ${payment.recurringPaymentId}`);
  }
});

maintenance.forEach(job => {
  const label = job.vehicle || job.vehicleId || job.id || 'Unknown maintenance job';
  if (job.vehicleId && !vehicleById.has(String(job.vehicleId))) add(errors, 'Maintenance job points to missing vehicle id', `${label} -> ${job.vehicleId}`);
  if (!job.vehicleId && job.vehicle && !vehicleByName.has(norm(job.vehicle))) add(warnings, 'Maintenance vehicle text does not match fleet', `${label} -> ${job.vehicle}`);
});

console.log(`Data consistency checked: ${path.relative(root, target) || target}`);
console.log(`Errors: ${errors.length}`);
errors.forEach(error => console.log(`ERROR ${error}`));
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 50).forEach(warning => console.log(`WARN ${warning}`));
if (warnings.length > 50) console.log(`WARN ...and ${warnings.length - 50} more`);

if (errors.length) process.exit(1);
