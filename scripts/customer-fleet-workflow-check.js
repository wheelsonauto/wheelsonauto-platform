const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function requireText(label, source, text) {
  if (!source.includes(text)) fail(label + ' is missing: ' + text);
}

function finalFunctionSlice(source, name) {
  let start = -1;
  let cursor = 0;
  while (true) {
    const next = source.indexOf('function ' + name + '(', cursor);
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const argsClose = source.indexOf(')', start);
  const open = source.indexOf('{', argsClose > -1 ? argsClose : start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

const recurringReadyOptions = finalFunctionSlice(app, 'recurringReadyVehicleOptions');
const customerFileOptions = finalFunctionSlice(app, 'customerFileVehicleOptions');
const saveContractHandler = app.slice(app.indexOf("if(!b||b.dataset.action!=='save-contract-file')"), app.indexOf("function reactivateCustomerModal", app.indexOf("if(!b||b.dataset.action!=='save-contract-file')")));
const saveVehicleHandler = app.slice(app.indexOf("if(!b||b.dataset.action!=='save-vehicle')"), app.indexOf("function openMaintenanceModal", app.indexOf("if(!b||b.dataset.action!=='save-vehicle')")));
const endCustomer = finalFunctionSlice(app, 'confirmEndCustomerFile');
const assignAutopayVehicle = finalFunctionSlice(server, 'assignAutopayVehicle');

[
  'id="rVehicleSearch"',
  "e.target.id==='rVehicleSearch'",
  'filterReadyVehicleSelect(e.target.value)',
  'selectedRecurringVehicle',
  'Choose a ready fleet vehicle',
  'VIN ',
  'Tag ',
  'Tracker ',
  'status'
].forEach(text => requireText('Add autopay vehicle picker', app + recurringReadyOptions, text));

[
  'id="fileVehicleSearch"',
  "e.target.id==='fileVehicleSearch'",
  'filterCustomerFileVehicleSelect(e.target.value)',
  "e.target.id==='fileVehicleId'",
  'fillCustomerFileVehicleFields',
  'resolveCustomerFileVehicle',
  'Search / switch vehicle',
  'VIN ',
  'Tag ',
  'Tracker ',
  'Assigned to ',
  'Ready fleet'
].forEach(text => requireText('Customer file vehicle picker', app + customerFileOptions, text));

[
  'transferVehicleToCustomer',
  'releaseCustomerVehicleOnly',
  'updateRecurringState',
  'db.payments',
  'db.messages',
  "tab=removed?'History':'Active'",
  'Customer file, car, payments, and service synced'
].forEach(text => requireText('Customer file save sync', saveContractHandler, text));

[
  'returningCustomer',
  'clearVehicleFromCustomerRecords',
  'Vehicle returned to Ready fleet from vehicle edit.',
  'syncVehicleCustomerAssignment',
  "tab=existing.currentCustomer?'Assigned':'Fleet'"
].forEach(text => requireText('Fleet return/save sync', saveVehicleHandler, text));

[
  'endFileDate',
  'endFileMileage',
  'stopCustomerAutopayForReturn',
  "car.status='Ready'",
  "c.status='Removed'",
  "view='Payments'",
  "tab='History'"
].forEach(text => requireText('End customer return workflow', endCustomer, text));

[
  'previousCustomer',
  'Vehicle reassigned to ',
  "row.status = 'Returned'",
  "row.stage = 'History'",
  "row.status = 'Removed'",
  "row.autoChargeEnabled = false",
  'contract.vehicleId = autopay.vehicleId',
  'contract.vin = autopay.vin',
  'contract.licensePlate = tag',
  'contract.tracker = autopay.tracker',
  'customer.stage'
].forEach(text => requireText('Server autopay assignment truth layer', assignAutopayVehicle, text));

console.log('Customer/fleet workflow check passed: searchable vehicle pickers, reassignment, return/end customer, and backend autopay assignment truth layer are wired.');
