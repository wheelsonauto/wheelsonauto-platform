const fs = require('node:fs');
const path = require('node:path');
const { firstUserArgument } = require('./cli-arguments');

const root = path.resolve(__dirname, '..');
const targetArgument = firstUserArgument();
const target = targetArgument ? path.resolve(process.cwd(), targetArgument) : path.join(root, 'seed.json');
const data = JSON.parse(fs.readFileSync(target, 'utf8'));

const errors = [];
const warnings = [];

function rows(name) {
  return Array.isArray(data[name]) ? data[name] : [];
}

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function vehicleName(vehicle = {}) {
  return vehicle.name || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ').trim() || [vehicle.year, vehicle.makeModel].filter(Boolean).join(' ').trim() || 'Vehicle';
}

function inactiveStatus(value) {
  return /removed|returned|ended|closed|history|denied|applicant|lead|pending application|new/i.test(String(value || ''));
}

function activeRow(row) {
  return !inactiveStatus(row && (row.status || row.stage || row.endStatus));
}

function weakName(value) {
  const raw = String(value || '').trim();
  return !raw || /^(unknown|unmatched|customer match needed|customer|clover recurring customer|n\/a|na)$/i.test(raw);
}

function add(collection, message, detail) {
  collection.push(detail ? `${message}: ${detail}` : message);
}

const vehicles = rows('vehicles');
const vehicleById = new Map(vehicles.map(vehicle => [String(vehicle.id || ''), vehicle]).filter(([id]) => id));

function vehicleKey(vehicle) {
  if (!vehicle) return '';
  if (vehicle.id) return `id:${vehicle.id}`;
  if (vehicle.vin) return `vin:${norm(vehicle.vin)}`;
  if (vehicle.plate || vehicle.stock) return `plate:${norm(vehicle.plate || vehicle.stock)}`;
  return '';
}

function findVehicle(row = {}) {
  if (row.vehicleId && vehicleById.has(String(row.vehicleId))) return vehicleById.get(String(row.vehicleId));
  const vin = norm(row.vin);
  if (vin) {
    const matches = vehicles.filter(vehicle => norm(vehicle.vin) === vin);
    if (matches.length === 1) return matches[0];
  }
  const plate = norm(row.licensePlate || row.plate || row.tag || row.stock);
  if (plate) {
    const matches = vehicles.filter(vehicle => norm(vehicle.plate || vehicle.stock) === plate);
    if (matches.length === 1) return matches[0];
  }
  const name = norm(row.vehicle);
  if (name) {
    const matches = vehicles.filter(vehicle => norm(vehicleName(vehicle)) === name || norm(vehicle.name) === name);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

const claims = new Map();
function claimVehicle(source, row, customer) {
  if (weakName(customer) || !activeRow(row)) return;
  const vehicle = row && row.id && String(row.id).startsWith('veh-') ? row : findVehicle(row);
  const key = vehicleKey(vehicle);
  if (!key) return;
  const claim = {
    source,
    customer: String(customer || '').trim(),
    id: String(row && row.id || vehicle && vehicle.id || ''),
    vehicle: vehicle ? vehicleName(vehicle) : String(row && row.vehicle || ''),
    vin: vehicle && vehicle.vin || row && row.vin || '',
    plate: vehicle && (vehicle.plate || vehicle.stock) || row && (row.licensePlate || row.plate) || ''
  };
  if (!claims.has(key)) claims.set(key, []);
  claims.get(key).push(claim);
}

vehicles.forEach(vehicle => {
  const status = String(vehicle.status || '').toLowerCase();
  if (vehicle.currentCustomer && !['ready', 'available', 'coming soon'].includes(status)) claimVehicle('fleet currentCustomer', vehicle, vehicle.currentCustomer);
});

rows('customers').forEach(row => claimVehicle('customer', row, row.name || row.customer));
rows('contracts').forEach(row => claimVehicle('customer file', row, row.customer || row.name));
rows('recurringPayments').forEach(row => claimVehicle('autopay', row, row.customer || row.name));
((((data.integrations || {}).clover || {}).recurringPlanMembers) || []).forEach(row => claimVehicle('clover recurring', row, row.customer || row.name));

claims.forEach((items, key) => {
  const activeNames = [...new Set(items.map(item => norm(item.customer)).filter(Boolean))];
  if (activeNames.length > 1) {
    add(errors, 'One active vehicle is claimed by multiple customers', `${key} -> ${items.map(item => `${item.customer} (${item.source}:${item.id})`).join(' | ')}`);
  }
});

let importRows = [];
try {
  const body = JSON.parse(fs.readFileSync(path.join(root, 'vehicle-import.json'), 'utf8'));
  importRows = Array.isArray(body.rows) ? body.rows : [];
} catch {
  importRows = [];
}

function importVehicleName(row) {
  return [row.year, row.makeModel].filter(Boolean).join(' ').trim() || 'Imported vehicle';
}

function importVehicle(row) {
  const vin = norm(row.vin);
  if (vin) {
    const exact = vehicles.find(vehicle => norm(vehicle.vin) === vin);
    if (exact) return exact;
  }
  const plate = norm(row.licensePlate);
  if (plate) {
    const exact = vehicles.find(vehicle => norm(vehicle.plate || vehicle.stock) === plate);
    if (exact) return exact;
  }
  return vehicles.find(vehicle => String(vehicle.sourceRow || '') === String(row.rowNumber)) || null;
}

const hasVehicleSheetData = vehicles.some(vehicle => String(vehicle.source || '').includes('Vehicle sheet import') || vehicle.sourceRow);
if (hasVehicleSheetData) importRows.filter(row => row.customer).forEach(row => {
  const vehicle = importVehicle(row);
  const rowLabel = `sheet row ${row.rowNumber} ${row.customer} ${importVehicleName(row)}`;
  if (!vehicle) return add(warnings, 'Imported customer row has no matching fleet vehicle', rowLabel);
  if (!vehicle.manuallyEditedAt && norm(vehicle.currentCustomer) !== norm(row.customer)) {
    add(errors, 'Imported fleet vehicle current customer is not synced to source row', `${rowLabel} -> fleet says ${vehicle.currentCustomer || 'empty'}`);
  }
  const expectedVehicleId = vehicle.id || '';
  const customer = rows('customers').find(item => item.id === 'cus-sheet-' + String(row.rowNumber).padStart(3, '0') || String(item.importedVehicleRow || '') === String(row.rowNumber));
  if (customer && String(customer.source || '').includes('Vehicle sheet import') && !customer.manuallyEditedAt && customer.vehicleId && customer.vehicleId !== expectedVehicleId) {
    add(errors, 'Imported customer row points to the wrong fleet vehicle', `${rowLabel} -> ${customer.vehicleId} should be ${expectedVehicleId}`);
  }
  const contract = rows('contracts').find(item => item.id === 'WOA-SHEET-' + String(row.rowNumber).padStart(3, '0'));
  if (contract && String(contract.source || '').includes('Vehicle sheet import') && activeRow(contract) && contract.vehicleId && contract.vehicleId !== expectedVehicleId) {
    add(errors, 'Imported customer file points to the wrong fleet vehicle', `${rowLabel} -> ${contract.vehicleId} should be ${expectedVehicleId}`);
  }
});

console.log(`Workflow integrity checked: ${path.relative(root, target) || target}`);
console.log(`Errors: ${errors.length}`);
errors.forEach(error => console.log(`ERROR ${error}`));
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 50).forEach(warning => console.log(`WARN ${warning}`));
if (warnings.length > 50) console.log(`WARN ...and ${warnings.length - 50} more`);

if (errors.length) process.exit(1);
