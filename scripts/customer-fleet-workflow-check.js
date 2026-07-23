const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const stateRepository = fs.readFileSync(path.join(root, 'state-repository.js'), 'utf8');
const stateRepositoryRuntime = require('../state-repository');

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
const openContract = finalFunctionSlice(app, 'openContract');
const customerTimeline = finalFunctionSlice(app, 'customerTimeline');
const maintenanceFileDetail = finalFunctionSlice(app, 'maintenanceFileDetail');
const saveContractHandler = app.slice(app.indexOf("if(!b||b.dataset.action!=='save-contract-file')"), app.indexOf("function reactivateCustomerModal", app.indexOf("if(!b||b.dataset.action!=='save-contract-file')")));
const saveVehicleHandler = app.slice(app.indexOf("if(!b||b.dataset.action!=='save-vehicle')"), app.indexOf("function openMaintenanceModal", app.indexOf("if(!b||b.dataset.action!=='save-vehicle')")));
const endCustomer = finalFunctionSlice(app, 'confirmEndCustomerFile');
const tollParser = finalFunctionSlice(app, 'parseTollImportRows');
const tollMatcher = finalFunctionSlice(server, 'tollImportMatch') + finalFunctionSlice(server, 'tollVehicleTags') + finalFunctionSlice(server, 'tollCustomerProfile');
const tollClaim = finalFunctionSlice(server, 'prepareTollImport');
const tollSave = finalFunctionSlice(server, 'importTollRows');
const assignAutopayVehicle = finalFunctionSlice(server, 'assignAutopayVehicle');
const activeAssignmentRecord = finalFunctionSlice(server, 'activeAssignmentRecord');
const activeAssignmentCandidate = finalFunctionSlice(stateRepository, 'activeAssignmentCandidate');
const syncVehicleAssignmentsFromActiveRecords = finalFunctionSlice(server, 'syncVehicleAssignmentsFromActiveRecords');
const addRecurringRoute = server.slice(server.indexOf("if (url.pathname === '/api/recurring-payments' && req.method === 'POST')"), server.indexOf("if (url.pathname === '/api/recurring-payments/update'", server.indexOf("if (url.pathname === '/api/recurring-payments' && req.method === 'POST')")));
const updateRecurringRoute = server.slice(server.indexOf("if (url.pathname === '/api/recurring-payments/update' && req.method === 'POST')"), server.indexOf("if (url.pathname === '/api/recurring-payments/remove'", server.indexOf("if (url.pathname === '/api/recurring-payments/update' && req.method === 'POST')")));
const removeRecurringRoute = server.slice(server.indexOf("if (url.pathname === '/api/recurring-payments/remove' && req.method === 'POST')"), server.indexOf("if (url.pathname === '/api/card-setup-requests/delete'", server.indexOf("if (url.pathname === '/api/recurring-payments/remove' && req.method === 'POST')")));

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
  'guardCustomerFileVehicleSave',
  'did not match one fleet car',
  'db.payments',
  'db.messages',
  "tab=removed?'History':'Active'",
  'Customer file, car, payments, and service synced'
].forEach(text => requireText('Customer file save sync', saveContractHandler, text));

[
  'maintenanceFileDetail',
  'vehicleIdentityLine',
  'inspectionChecklistSummary',
  'mechanicSignoff',
  'VIN / tag / inspection',
  'Recent file activity'
].forEach(text => requireText('Customer file service truth', openContract + customerTimeline + maintenanceFileDetail, text));

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
  'JSON.parse',
  'provider',
  'amount'
].forEach(text => requireText('Manual toll import parser', tollParser, text));

[
  'tagplatenumber',
  'tollVehicleTags',
  'vehicle.vin',
  'currentCustomer',
  'tollCustomerProfile',
  'Saved E-ZPass tag mapping',
  'Customer assigned on toll date'
].forEach(text => requireText('Manual toll import matching', tollMatcher, text));

[
  'vehicleId',
  'vin',
  'plate',
  'customerMatchStatus',
  'Matched from toll import',
  'Needs payment/customer match',
  'E-ZPass CSV import',
  'transactionDate',
  'postingDate'
].forEach(text => requireText('Manual toll import claim truth layer', tollClaim, text));

[
  'data.claims.unshift',
  'appendAuditLog',
  'Toll / violation statement imported'
].forEach(text => requireText('Manual toll import save flow', tollSave, text));

[
  'previousCustomer',
  'Vehicle reassigned to ',
  "row.status = 'Returned'",
  "row.stage = 'History'",
  "row.status = 'Removed'",
  "row.autoChargeEnabled = false",
  'data.maintenance',
  'job.customer = autopay.customer',
  'job.customerSyncedAt',
  'contract.vehicleId = autopay.vehicleId',
  'contract.vin = autopay.vin',
  'contract.licensePlate = tag',
  'contract.tracker = autopay.tracker',
  'customer.stage'
].forEach(text => requireText('Server autopay assignment truth layer', assignAutopayVehicle, text));

[
  'data.contracts = Array.isArray(data.contracts)',
  'data.customers.unshift',
  'data.contracts.unshift',
  'vin: autopay.vin',
  'weeklyAmount: autopay.amount',
  'weekly: autopay.amount',
  'Customer file created from WheelsonAuto autopay setup.',
  'source: \'WheelsonAuto autopay\''
].forEach(text => requireText('Autopay creates full customer file', addRecurringRoute, text));

requireText('Review modal navigation should close the old overlay', app, 'closeModalBeforeWorkspaceNavigation');
requireText('Review modal navigation should target workspace links only', app, "#modalBackdrop button[data-view]");

[
  'activeAssignmentRecord',
  'syncRowVehicleIdentity',
  'vehicle.currentCustomer = customer',
  'job.previousCustomer',
  'assignmentConflict',
  'if (!list.length)',
  'delete vehicle.assignmentConflict',
  'data.integrations.clover.recurringPlanMembers',
  'serviceRowsSynced'
].forEach(text => requireText('Server active assignment truth repair', syncVehicleAssignmentsFromActiveRecords, text));

requireText('Profile enrichment should run assignment truth repair', server, 'const assignmentSync = syncVehicleAssignmentsFromActiveRecords(data)');
requireText('Autopay schedule update should refresh linked truth layer before save', updateRecurringRoute, 'enrichLinkedProfiles(data)');
requireText('Autopay removal should refresh linked truth layer before save', removeRecurringRoute, 'enrichLinkedProfiles(data)');
requireText('Server assignment truth must use the shared transactional rule', activeAssignmentRecord, 'stateRepository.activeAssignmentCandidate');
requireText('Pending intake rows must not claim a live assignment', activeAssignmentCandidate, 'INACTIVE_ASSIGNMENT_PATTERN');
requireText('The shared assignment rule must exclude pending intake', stateRepository, 'pending application');
requireText('Saved-card onboarding rows must not claim a fleet vehicle before handoff', activeAssignmentCandidate, 'row.onboardingSessionId && !row.pickupCompletedAt');
if (stateRepositoryRuntime.activeAssignmentCandidate({ customer: 'Test Applicant', vehicleId: 'veh-test', status: 'Card linked', onboardingSessionId: 'onboard-test' }, 'recurringPayments') !== null) fail('A card-linked unpaid onboarding row claimed a fleet assignment.');
if (!stateRepositoryRuntime.activeAssignmentCandidate({ customer: 'Active Customer', vehicleId: 'veh-live', status: 'Active' }, 'recurringPayments')) fail('A normal active recurring customer should remain valid assignment evidence.');

console.log('Customer/fleet workflow check passed: searchable vehicle pickers, reassignment, return/end customer, and backend autopay assignment truth layer are wired.');
