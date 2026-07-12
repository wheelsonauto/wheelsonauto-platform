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
    const normalNext = source.indexOf('function ' + name + '(', cursor);
    const asyncNext = source.indexOf('async function ' + name + '(', cursor);
    const candidates = [normalNext, asyncNext].filter(index => index >= 0);
    const next = candidates.length ? Math.min(...candidates) : -1;
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

function actionSlice(action) {
  const marker = "a==='" + action + "'";
  const start = app.indexOf(marker);
  return start < 0 ? '' : app.slice(start, start + 3200);
}

const maintenance = finalFunctionSlice(app, 'Maintenance');
const fleet = finalFunctionSlice(app, 'Fleet');
const claims = finalFunctionSlice(app, 'ClaimsIssues');
const reports = finalFunctionSlice(app, 'Reports');
const organizations = finalFunctionSlice(app, 'Organizations');
const apiRoadmap = finalFunctionSlice(app, 'ApiRoadmap');
const managerPortal = finalFunctionSlice(app, 'ManagerPortal');
const mechanicPortal = finalFunctionSlice(app, 'MechanicPortal');
const navForRole = finalFunctionSlice(app, 'navForRole');
const staffServiceCard = finalFunctionSlice(app, 'staffServiceCard');
const staffClaimCard = finalFunctionSlice(app, 'staffClaimCard');
const staffFleetCard = finalFunctionSlice(app, 'staffFleetCard');
const vehicleIdentityLine = finalFunctionSlice(app, 'vehicleIdentityLine');
const executiveReport = finalFunctionSlice(app, 'executiveReportBoard');
const dailyCloseout = finalFunctionSlice(app, 'dailyCloseout');
const claimMatchNote = finalFunctionSlice(app, 'claimMatchNote');
const operationsQueue = finalFunctionSlice(app, 'operationsQueue');

[
  maintenance,
  fleet,
  claims,
  reports,
  organizations,
  apiRoadmap,
  managerPortal,
  mechanicPortal,
  staffServiceCard,
  staffClaimCard,
  staffFleetCard,
  vehicleIdentityLine,
  executiveReport,
  dailyCloseout,
  claimMatchNote,
  operationsQueue
].forEach((source, index) => {
  if (!source) fail('Missing operations function #' + index);
});

[
  'Search service by customer, VIN, tag, tracker, issue',
  'Service work',
  'Maintenance',
  'complete-maintenance',
  'open-maintenance',
  'vehicleIdentityLine',
  'VIN:',
  'Tracker:'
].forEach(text => requireText('Maintenance/service surface', maintenance + staffServiceCard + vehicleIdentityLine, text));

[
  'isMonthlyMaintenance',
  'addMonthsKey',
  'nextDue',
  'Completed',
  'Mark done',
  'mDoneMileage',
  'mDoneCondition',
  'mDoneDamage',
  'mDoneSignoff',
  'inspectionChecklistInputs',
  'readInspectionChecklist',
  'inspectionChecklist',
  'lastInspectionChecklist',
  'inspectionCondition',
  'mechanicSignoff',
  'await save()',
  'Maintenance()'
].forEach(text => requireText('Monthly inspection completion flow', app + actionSlice('confirm-complete-maintenance'), text));

[
  'Search available fleet by VIN, tag, tracker',
  'Search assigned cars by customer, VIN, tag, tracker',
  'Available fleet',
  'Rented / assigned cars',
  'Assignment conflict',
  'Claimed by',
  'compact-conflict',
  'open-vehicle',
  'vehicleIdentityLine'
].forEach(text => requireText('Fleet operations surface', fleet + staffFleetCard, text));

[
  'claims, tolls & issues',
  'Search claims by customer, vehicle, plate, ref, type',
  'Needs payment/customer match',
  'Import tolls',
  'parseTollImportRows',
  'Matched from toll import',
  'save-toll-import',
  'apply-claim-match',
  'matchReason',
  'candidate.vin',
  'candidate.plate',
  'candidate.tracker',
  'send-claim-link',
  'Provider / agency',
  'Next follow-up'
].forEach(text => requireText('Claims/tolls/disputes surface', claims + claimMatchNote + staffClaimCard + app, text));

[
  'downloadReportCsv',
  'reportCsvRows',
  'Executive snapshot',
  'Collected today',
  'Expected today',
  'Failed / retry',
  'Ready fleet',
  'Open service',
  'Applications',
  'Paid records',
  'Fleet profitability',
  'Customer truth',
  'Verification inbox',
  'WheelsonAuto verification',
  'Documents / verification',
  'reportDocumentClearedForCustomer',
  'reportClaimCandidateNote',
  'reportPaymentCandidateNote',
  'closeoutPaymentPossibleMatches',
  'Failed twice',
  'Payment not found',
  'Unmatched payments',
  'Open payment requests',
  'Stale payment links',
  'Open card setup links',
  'Pending Star approvals',
  'Customer portal access',
  'customer_portal_access',
  'customerPortalAccountForName',
  'customerPortalLoginReady',
  '/api/customer-accounts/create-missing-drafts',
  'Draft customer portal login created by WheelsonAuto',
  'login-ready customer portal account',
  'Payment request truth',
  'payment_request_truth',
  'WheelsonAuto hosted checkout',
  'open_payment_requests',
  'stale_payment_requests',
  'open_card_setup_links',
  'pending_star_approvals',
  'Vehicle assignment conflicts',
  'Setup needed',
  'Missing contact',
  'Insurance proof',
  'Background checks',
  'dispute_match_review',
  '/api/reports/deep.csv',
  '/api/system/health',
  'systemHealthSnapshot',
  'vehicle_assignment_conflict',
  'Role-scoped Star/system health snapshot',
  'Star can draft fixes and messages',
  "fetch('/api/reports/deep.csv'",
  'downloadCsvBlob',
  'deepReportCsv',
  'reportRowsForData',
  'Role-scoped deep CSV export',
  'carProfitabilityPanel',
  'Car profitability & recovery',
  'Open owed',
  'Net / risk',
  'recovered tolls/violations/damage',
  'customerRiskReportPanel',
  'Customer risk report',
  'Star QA',
  'Claims / tolls / disputes',
  'Audit trail',
  'paymentRequests',
  'auditTrailPanel'
].forEach(text => requireText('Reports/accounting surface', app + reports + executiveReport + server, text));

[
  'Expected today',
  'Collected today',
  'Paid outside app',
  'Still open',
  'Failed once',
  'Contact now',
  'Today Clover transactions',
  'Open payment links',
  'Stale payment links',
  'stalePaymentRequests',
  'close-payment-link',
  'Hosted payment link closed',
  'No open hosted checkout links are waiting for closeout follow-up',
  'Sensitive changes',
  'Verification inbox',
  'Vehicle conflicts',
  'assignmentConflicts',
  'No vehicle assignment conflicts are waiting for closeout review',
  'Vehicle assignment conflicts:',
  'Paid-outside, document, service, toll, claim, or proof items waiting for review',
  'send-daily-closeout-email',
  'signoff-daily-closeout',
  'Daily closeout signed off',
  'closeoutSnapshot',
  'openCardSetupLinks',
  'pendingStarApprovals',
  'Card setup',
  'Star approvals',
  'print-daily-closeout',
  'Star closeout summary',
  'auditEvents'
].forEach(text => requireText('Daily closeout operations board', dailyCloseout + app + server, text));

[
  'Assignment conflict',
  'Claimed by',
  'assignmentConflict',
  'VIN missing',
  'Tag missing',
  'Resolve',
  "view:\"Operations\"",
  "tab:\"Assigned\""
].forEach(text => requireText('Operations queue assignment conflicts', operationsQueue, text));

[
  'Company accounts',
  'Franchise readiness',
  'Staff scoping',
  'isolated database storage',
  'per-company',
  'tenant isolation',
  'Add staff',
  'Staff list',
  'company-scoped workspace',
  'Subscriber mode needs final API separation',
  'new-org',
  'save-org'
].forEach(text => requireText('Company/franchise foundation UI', organizations + app, text));

[
  'Clover',
  'SMS',
  'Email',
  'EZPass',
  'Insurance',
  'Tracker',
  'Accounting',
  'Provider dependency matrix',
  'Saved-card payments',
  'Safe mode now',
  'T-Mobile handles voice',
  'admin-approved',
  'apiProviders',
  'save-api-provider',
  'apiLiveTest'
].forEach(text => requireText('API-ready roadmap UI', apiRoadmap + app, text));

[
  'truthChecks',
  'dataOk',
  'dataIssueCount',
  'autopay_vehicle_link',
  "vehicle_assignment_conflict', 'Vehicle assignment conflicts'",
  "'Operations', 'Assigned'",
  'Customer/payment/fleet truth',
  'Data truth'
].forEach(text => requireText('System readiness truth checks', server + app, text));

[
  'Manager Portal',
  'fleetCommandPanel',
  'Search manager queue',
  'manager-overview-grid',
  'Messages',
  'Reports'
].forEach(text => requireText('Manager operations role surface', managerPortal + navForRole, text));

[
  'Mechanic Portal',
  'no payment or settings controls',
  'mechanicJobCards',
  'mechanic-workspace',
  'complete-maintenance',
  'open-maintenance'
].forEach(text => requireText('Mechanic operations role surface', mechanicPortal + staffServiceCard, text));

[
  'cloverWebhookDisputeClaim',
  'Clover dispute',
  'resolveClaimCustomerLinks',
  'claimPossibleMatches',
  'tollViolationRecoveryRows',
  'toll_violation_recovery',
  'Toll/violation recovery',
  'customerMatchStatus',
  'Needs payment/customer match',
  'Payment record',
  'Recurring customer',
  'Fleet vehicle'
].forEach(text => requireText('Backend dispute/claim matching', server, text));

[
  'Phone ',
  'Email ',
  'Ref ',
  'Autopay ',
  'Clover customer '
].forEach(text => requireText('Dispute possible-match evidence', claimMatchNote + server, text));

[
  'cleanOrganizationPayload',
  'dataScopedToOrganization',
  'stateForUserRead',
  'stateForUserWrite',
  'organizationId',
  'Choose a saved company/store for this staff account.',
  'Duplicate company/franchise names should be blocked'
].forEach(text => requireText('Backend company/franchise foundation', server + fs.readFileSync(path.join(root, 'scripts/server-direct-smoke-test.js'), 'utf8'), text));

[
  'cleanApiProviderPayload',
  'defaultApiProviderRows',
  'apiProviderRows',
  'syncApiProviderDispatchTask',
  'apiProviderReadyForLiveUse',
  'task-api-',
  'Auto-closed because this provider is marked Connected',
  'apiProviderReviewRows',
  "status.includes('testing')",
  'api_provider_readiness',
  'API provider readiness',
  '/api/api-providers',
  'lastTestResult',
  'envKeys',
  'endpoint'
].forEach(text => requireText('Backend API provider readiness', server, text));

console.log('Operations readiness check passed: inspections/service, fleet, claims/tolls/disputes, reports, company scoping, and API roadmap are wired.');
