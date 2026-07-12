const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function fail(message) {
  throw new Error(message);
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

function strings(source) {
  return [...source.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]);
}

function assertIncludes(label, source, required) {
  if (!source) fail(label + ' block was not found.');
  const missing = required.filter(text => !source.includes(text));
  if (missing.length) fail(label + ' is missing: ' + missing.join(', '));
}

function assertExcludes(label, source, banned) {
  if (!source) fail(label + ' block was not found.');
  const present = banned.filter(text => source.includes(text));
  if (present.length) fail(label + ' should not include: ' + present.join(', '));
}

function assertStringsInclude(label, source, required) {
  const values = strings(source);
  const missing = required.filter(value => !values.includes(value));
  if (missing.length) fail(label + ' is missing strings: ' + missing.join(', '));
}

function renderViews() {
  const render = finalFunctionSlice(app, 'render');
  const match = render.match(/\(\{([^}]+)\}\[view\]\|\|Dashboard\)\(\)/);
  if (!match) fail('Could not find render view map.');
  const views = new Map();
  for (const item of match[1].matchAll(/'([^']+)'\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    views.set(item[1], item[2]);
  }
  return views;
}

[
  'Dashboard',
  'Payments',
  'Operations',
  'Messages',
  'MechanicPortal',
  'ManagerPortal',
  'Maintenance',
  'Fleet',
  'ClaimsIssues',
  'Reports',
  'Website',
  'Settings',
  'mobileQuickbar',
  'navForRole',
  'hydrateLocalSearches',
  'openComposeMessage',
  'messageSetupPanel',
  'starAiPanel',
  'starQaManagerPanel',
  'starCommandItems',
  'starCommandCenter',
  'platformReadinessItems',
  'platformReadinessBoard',
  'managerCommandItems',
  'managerCommandBoard',
  'mechanicCommandItems',
  'mechanicCommandBoard',
  'coreSystemItems',
  'coreSystemBoard',
  'starCapabilityItems',
  'starReadinessPanel',
  'staffServiceCard',
  'staffClaimCard',
  'proofLine',
  'paymentRecurringCard',
  'paymentCustomerCard',
  'paymentCardSection',
  'vehicleTrackingStatus',
  'vehicleTrackingLine',
  'verificationDocs',
  'verificationDocForCustomer',
  'verificationDocClearedForCustomer',
  'documentNeedsVerification',
  'verificationStatusTone',
  'verificationInboxItems',
  'verificationInboxSection',
  'Documents'
].forEach(name => {
  if (!finalFunctionSlice(app, name)) fail('Missing final frontend function: ' + name);
});

const views = renderViews();
[
  'Dashboard',
  'Payments',
  'Operations',
  'Messages',
  'Mechanic Portal',
  'Manager Portal',
  'Maintenance',
  'Fleet',
  'Claims & Issues',
  'Reports',
  'Website',
  'Settings'
].forEach(view => {
  if (!views.has(view)) fail('Render map is missing view: ' + view);
});

const dashboard = finalFunctionSlice(app, 'Dashboard');
assertIncludes('Dashboard surface', dashboard, [
  'dueOrTouchedToday',
  'pendingToday',
  'failedToday',
  'paymentState',
  'transactionCustomerName',
  'localSearch',
  'dashboardDueRows',
  'Today&rsquo;s dues & contact',
  'Service due',
  'Transactions'
]);

const payments = finalFunctionSlice(app, 'Payments');
assertIncludes('Payments surface', payments, [
  'paymentCloseoutBoard',
  'dailyCloseout',
  'Active',
  'Today',
  'History',
  'Transactions',
  'paymentRecurringCard',
  'paymentCustomerCard',
  'paymentTransactionCard',
  'Payment actions',
  'Existing customer',
  'Add autopay'
]);

const paymentCardSection = finalFunctionSlice(app, 'paymentCardSection');
assertIncludes('Payment card section helper', paymentCardSection, ['localSearch', 'customer-pay-list', 'data-limit']);

assertIncludes('Payment receipt surface', app, [
  'paymentReceiptBody',
  'paymentReceiptDocuments',
  'send-payment-receipt',
  'Payment receipt',
  'Paid payment proof',
  '/api/messages/send',
  'paymentId:p.id'
]);

assertIncludes('Daily closeout notes surface', app + server, [
  'Owner closeout notes',
  'closeoutOwnerNotes',
  'save-closeout-note',
  'signoff-daily-closeout',
  'closeoutSnapshot',
  'Open links',
  'Stale links',
  'openPaymentLinks',
  'openPaymentLinkAmount',
  'stalePaymentLinks',
  'stalePaymentLinkAmount',
  'openCardSetupLinks',
  'pendingStarApprovals',
  'Card setup',
  'Star approval',
  'close-payment-link',
  'signedAt',
  'signedBy',
  'Daily closeout signed off',
  'print-daily-closeout',
  'printDailyCloseout',
  'ownerNote',
  'dailyCloseouts',
  'Sensitive changes',
  'Verification inbox',
  'No customer-submitted proof or paid-outside reports are waiting for verification',
  'auditEvents'
]);

assertIncludes('Communications report export surface', app + server, [
  'safeReportText',
  'communicationReportRows',
  'Messages / communications',
  'staffAccountId',
  'customerAccountId',
  'Star AI draft/action',
  '[redacted-hash]',
  'payment[_ -]?source',
  'reportRowsForData',
  'reportCsvRows'
]);

const documents = finalFunctionSlice(app, 'Documents');
assertIncludes('Documents surface', documents + app + server, [
  'Portal visibility',
  'Customer visible',
  'Staff only',
  'Background check',
  'Verified by',
  'docVisibility',
  'docProvider',
  'docPolicy',
  'customerVisible',
  'portalVisible',
  'paymentReceiptDocuments',
  'Needs review',
  'Verification inbox',
  'Customer proof, paid-outside reports, service proof, tolls, claims, and document uploads waiting for staff review.',
  'verify-paid-outside',
  'reject-paid-outside',
  '/api/verification/paid-outside',
  '/api/verification/document',
  'Paid outside app',
  'Service proof',
  'Claim / toll proof',
  'verify-document',
  'reject-document',
  'Paid-outside payment verified',
  'Document proof verified',
  'Customer-submitted proof is waiting for staff verification',
  'Account document request',
  'Needs staff preparation',
  'Search documents, receipts',
  'Proof link / photo note',
  'customerPortalDocuments',
  'Documents & receipts'
]);

const marketing = finalFunctionSlice(app, 'Marketing');
assertIncludes('Marketing surface', marketing, [
  'Marketing command',
  'Lead board',
  'Search leads by customer, phone, email, car, source, or status',
  'Website tools',
  'Message queue',
  'future SMS/email campaign tracking'
]);

const customerPortalHtml = finalFunctionSlice(server, 'customerPortalHtml');
const customerPortalState = finalFunctionSlice(server, 'customerPortalState');
const customerPortalVisibleMessage = finalFunctionSlice(server, 'customerPortalVisibleMessage');
const stripCustomerPortalMessage = finalFunctionSlice(server, 'stripCustomerPortalMessage');
const stripCustomerPortalPayment = finalFunctionSlice(server, 'stripCustomerPortalPayment');
assertIncludes('Customer portal proof intake', customerPortalHtml + server, [
  '/customer/service-request',
  '/customer/issue-report',
  'Proof link / photo note',
	  'proofUrl',
	  '/customer/paid-outside',
	  '/customer/receipt-request',
	  'Request receipt',
	  'send_receipt',
	  'Open payment requests',
  'customerPortalPaymentRequestRow',
  'customerPortalCardSetupRequestRow',
  'cardSetupRequests',
  'Set up card',
  'isOpenCustomerPaymentRequest',
  'isOpenCardSetupRequest',
  'paymentRequestAgeLabel',
  'cardSetupRequestAgeLabel',
  'Pay securely',
  'Receipt photo link',
  'Photo link, dashboard light photo note',
  'Notice photo/link',
  'Proof link/note: ',
  'customerPortalServiceRow',
  'customerPortalPaymentRow',
  'customerPortalChecklistText',
  'VIN ',
  'Tag ',
  'payment.source',
  'Tracker '
]);
assertIncludes('Customer portal message privacy', customerPortalState + customerPortalVisibleMessage + stripCustomerPortalMessage, [
  'customerPortalVisibleMessage',
  'stripCustomerPortalMessage',
  'cardSetupRequests: cardSetupRequests.map(stripPrivateCustomerFields)',
  'customerAction',
  'star ai',
  'aiPlan',
  'aiDraftId',
  "safe.source = 'WheelsonAuto'",
  'customer portal',
  'sent',
  'delivered'
]);
assertIncludes('Customer portal payment privacy', customerPortalState + stripCustomerPortalPayment, [
  'stripCustomerPortalPayment',
  'payments: payments.map(stripCustomerPortalPayment)',
  'lastAutoChargeError',
  'cloverPaymentId',
  'externalReferenceId',
  'paymentSourceId',
  'Please contact WheelsonAuto'
]);

const insurance = finalFunctionSlice(app, 'Insurance');
assertIncludes('Insurance/background surface', insurance + app, [
  'Insurance & background command',
  'Background checks',
  'new-background-doc',
  'verificationDocs',
  'verificationDocClearedForCustomer',
  '!verificationDocClearedForCustomer',
  'Verification follow-up',
  'Message queue',
  'Background check not verified',
  'Search background by customer',
  'Documents / verification',
  "'Document'",
  'open-document',
  'Insurance/background',
  'Collect insurance proof',
  'Finish background checks'
]);

const auditTrailPanel = finalFunctionSlice(app, 'auditTrailPanel');
assertIncludes('Owner audit trail surface', auditTrailPanel + app + server, [
  'Audit trail',
  'Owner-only history',
  'appendAuditLog',
  'auditChangedSections',
  'delete safe.auditLogs'
]);

const paymentRecurringCard = finalFunctionSlice(app, 'paymentRecurringCard');
assertIncludes('Recurring payment cards', paymentRecurringCard, [
  'paymentContactFor',
  'paymentVehicleInfo',
  'VIN ',
  'latestPaymentFor',
  'recurringDateText',
  'cardActionButtons'
]);

const paymentCustomerCard = finalFunctionSlice(app, 'paymentCustomerCard');
assertIncludes('Customer payment/history cards', paymentCustomerCard, [
  'historyChargeButtons',
  'textCustomerButton',
  'customerFileButton',
  'open-vehicle',
  'VIN missing'
]);

const operations = finalFunctionSlice(app, 'Operations');
assertIncludes('Operations surface', operations, [
  'Fleet',
  'Assigned',
  'Service',
  'Claims',
  'staffFleetCard',
  'staffServiceCard',
  'staffClaimCard',
  'data-limit',
  'localSearch'
]);

const maintenance = finalFunctionSlice(app, 'Maintenance');
const serviceInspectionBoard = finalFunctionSlice(app, 'serviceInspectionBoard');
assertIncludes('Maintenance surface', maintenance, [
  'Open',
  'Overdue',
  'Monthly',
  'Completed',
  'staffServiceCard',
  'Search service by customer, VIN, tag, tracker, issue'
]);
assertIncludes('Service inspection command board', serviceInspectionBoard + maintenance + css, [
  'Inspection command',
  'Monthly inspection',
  'oil-change cycle',
  'Overdue service',
  'Due today',
  'Monthly / oil cycle',
  'Identity gaps',
  'Checklist / signoff',
  'Completed this month',
  'service-inspection-board',
  'service-inspection-grid',
  'service-inspection-card'
]);

const fleet = finalFunctionSlice(app, 'Fleet');
assertIncludes('Fleet surface', fleet, [
  'Available',
  'Prep',
  'Assigned',
  'VIN review',
  'Cars missing VINs block clean reports',
  'Search missing VIN by car, tag, tracker',
  'staffFleetCard',
  'staffPrepCard',
  'Search available fleet by VIN, tag, tracker',
  'Search assigned cars by customer, VIN, tag, tracker'
]);

const claims = finalFunctionSlice(app, 'ClaimsIssues');
assertIncludes('Claims surface', claims, [
  'Open',
  'History',
  'All',
  'staffClaimCard',
  'Search claims by customer, vehicle, plate, ref, type'
]);

const mechanicPortal = finalFunctionSlice(app, 'MechanicPortal');
assertIncludes('Mechanic portal surface', mechanicPortal, [
  'Work',
  'Overdue',
  'All open',
  'History',
  'mechanicJobCards',
  'mechanic-workspace',
  'no payment or settings controls'
]);
assertExcludes('Mechanic portal surface', mechanicPortal, ['Messages', 'Payments', 'New text/email']);

const managerPortal = finalFunctionSlice(app, 'ManagerPortal');
assertIncludes('Manager portal surface', managerPortal, [
  'Overview',
  'Fleet',
  'Applications',
  'Service',
  'Issues',
  'fleetCommandPanel',
  'Search manager queue',
  'manager-overview-grid'
]);

const messages = finalFunctionSlice(app, 'Messages');
assertIncludes('Messages and Star surface', messages, [
  'Inbox',
  'Star',
  'Queue',
  'Templates',
  'History',
  'Setup',
  'New text/email',
  'Email live',
  'Email draft',
  'message-inbox-layout',
  'messageConversationPanel',
  'starAiPanel',
  'starAiPromptPanel',
  'starAiLane',
  'Search customer, phone, email, VIN, tag, payment, or text',
  'Approval'
]);
assertIncludes('Message queue payment truth layer', app, [
  'messageQueueVehicleContext',
  '__woaBaseMessageQueueItems',
  "paymentState(r).key==='notfound'",
  'Payment not found',
  'Clover/card source missing',
  'VIN ',
  'Tracker '
]);

const compose = finalFunctionSlice(app, 'openComposeMessage');
assertIncludes('Compose message modal', compose, [
  '<select id="messageChannel">',
  '<option value="SMS"',
  '<option value="Email"',
  'messageEmail'
]);
assertIncludes('Message send action', app, ['/api/messages/send', 'channel:val', 'send-message-now', 'send-thread-message']);

const conversationPanel = finalFunctionSlice(app, 'messageConversationPanel');
assertIncludes('Message conversation panel', conversationPanel, [
  'message-conversation-panel',
  'message-bubbles',
  'messageQuickReply',
  'Ask Star',
  'Customer file'
]);

const starPrompt = finalFunctionSlice(app, 'starAiPromptPanel');
assertIncludes('Star prompt panel', starPrompt, [
  'Ask Star',
  'starPromptCustomer',
  'starPromptBody',
  'Prepare Star reply'
]);

const starPanel = finalFunctionSlice(app, 'starAiPanel');
const starReadiness = finalFunctionSlice(app, 'starReadinessPanel') + finalFunctionSlice(app, 'starCapabilityItems');
assertIncludes('Star AI panel', starPanel, [
  'Built-in message manager',
  'email',
  'EZPass/tolls',
  'receipts',
  'toggle-email-messaging',
  'toggle-star-ai',
  'toggle-star-autosend',
  'Need approval',
  'Human needed'
]);
assertIncludes('Star readiness panel', starReadiness + app, [
  'Star readiness',
  'Built-in AI manager status',
  'Test Star provider',
  'OpenAI connected',
  'Rules fallback',
  'Payment follow-up',
  'Tolls, claims, disputes',
  'Receipts and documents',
  'Safe auto-send',
  'Star is inside the app'
]);

const setupPanel = finalFunctionSlice(app, 'messageSetupPanel');
const notificationCommandBoard = finalFunctionSlice(app, 'notificationCommandBoard');
assertIncludes('Messaging setup panel', setupPanel, [
  'emailWebhook',
  'Email',
  'Star',
  'Email notifications',
  'notificationEmailTo',
  'notificationEventOptions',
  'send-email-notification-test'
]);
assertIncludes('Notification command board', notificationCommandBoard + app + css, [
  'Email notification command',
  'Owner email',
  'Email mode',
  'Events watched',
  'Daily closeout',
  'Customer replies',
  'Provider setup',
  'Email drafts in Messages',
  'notification-command-board',
  'notification-command-grid',
  'notification-command-card'
]);

const settings = finalFunctionSlice(app, 'Settings');
const organizations = finalFunctionSlice(app, 'Organizations');
const companyFoundationPanel = finalFunctionSlice(app, 'companyFoundationPanel');
const companyLaunchBoard = finalFunctionSlice(app, 'companyLaunchBoard');
const companyReadinessCards = finalFunctionSlice(app, 'companyReadinessCards');
const customerLoginForm = finalFunctionSlice(app, 'customerLoginAccountForm');
const customerPortalButton = finalFunctionSlice(app, 'customerPortalButton');
const paymentCustomerPortalCard = finalFunctionSlice(app, 'paymentCustomerCard');
const recurringCardActionButtons = finalFunctionSlice(app, 'cardActionButtons');
assertIncludes('Settings customer portal accounts', settings, ['Customer portal logins', 'new-customer-login', '/customer/login']);
assertIncludes('Settings staff password help', settings + server, ['Staff accounts', 'Reset requested', 'staff_password_reset', '/forgot', 'Reset staff access']);
assertIncludes('Company account staff actions', organizations + companyFoundationPanel + companyLaunchBoard + companyReadinessCards + app + css, ['Company accounts', 'Franchise readiness', 'Staff scoping', 'isolated database storage', 'per-company', 'Data scope', 'API key mode', 'Tenant readiness', 'Subscriber locked', 'Add staff', 'new-staff', 'Staff list', 'company-scoped workspace', 'Subscriber mode needs final API separation', 'Company launch guardrails', 'Internal store mode', 'Staff scoped access', 'Customer portal scope', 'Subscriber accounts', 'Per-company API keys', 'Billing connected', 'Owner audit + reports', 'company-launch-board', 'company-launch-grid', 'company-launch-card']);
const coreSystemItems = finalFunctionSlice(app, 'coreSystemItems');
const coreSystemBoard = finalFunctionSlice(app, 'coreSystemBoard');
const apiOperationalItems = finalFunctionSlice(app, 'apiOperationalItems');
const apiOperationalBoard = finalFunctionSlice(app, 'apiOperationalBoard');
assertIncludes('Core system board', coreSystemBoard + coreSystemItems, ['Core system board', 'iFleet-style operating system', 'Payment/autopay engine', 'Customer + fleet truth', 'Messages + Star', 'Customer portal', 'Tolls/violations/recovery', 'Claims + disputes', 'Franchise/company base', 'API-ready layer', 'Manual-live', 'Draft-live']);
assertIncludes('API operating bridge', apiOperationalItems + apiOperationalBoard + app + css, ['API operating bridge', 'All iFleet-style provider functions', 'APIs plug in last', 'Clover disputes + refunds', 'Saved-card charges', 'EZPass/tolls + violations', 'SMS/email messaging', 'Insurance/background checks', 'Tracker/location', 'Accounting + closeout exports', 'Franchise / multi-company', 'Works now:', 'API unlocks:', 'Must match:', 'api-operational-board', 'api-operational-grid', 'api-operational-card']);
assertIncludes('Customer portal account form', customerLoginForm, ['customerLoginName', 'customerLoginPassword', 'customerLoginRecurringId', 'customerLoginVehicleId']);
assertIncludes('Customer portal action helper', customerPortalButton, ['open-customer-login', 'new-customer-login', 'data-name']);
assertIncludes('Payment customer portal card actions', paymentCustomerPortalCard, ['customerPortalButton', 'Portal']);
assertIncludes('Recurring customer portal card actions', recurringCardActionButtons, ['customerPortalButton', 'Portal']);

const staffServiceCard = finalFunctionSlice(app, 'staffServiceCard');
const staffClaimCard = finalFunctionSlice(app, 'staffClaimCard');
const claimMatchNote = finalFunctionSlice(app, 'claimMatchNote');
const disputeRecoveryBoard = finalFunctionSlice(app, 'disputeRecoveryBoard');
const disputeRecoveryIssue = finalFunctionSlice(app, 'disputeRecoveryIssue');
const starHealth = finalFunctionSlice(app, 'starSystemHealthPanelFresh') || finalFunctionSlice(app, 'starSystemHealthPanel');
const starQaManager = (finalFunctionSlice(app, 'starQaManagerPanel') || '') + (finalFunctionSlice(app, 'starQaManagerPanelFresh') || '');
const starExport = finalFunctionSlice(app, 'starSystemHealthExport');
const trackerStatus = finalFunctionSlice(app, 'vehicleTrackingStatus');
const staffFleetCard = finalFunctionSlice(app, 'staffFleetCard');
const operationsQueue = finalFunctionSlice(app, 'operationsQueue');
assertIncludes('Staff service cards', staffServiceCard + app + css, ['roleName()===\'mechanic\'', 'vehicleIdentityLine', 'complete-maintenance', 'open-maintenance', 'proofLine', 'Open proof', 'proof-line']);
assertIncludes('Staff claim cards', staffClaimCard + app + css, ['isMechanicVisibleClaim', 'roleName()===\'mechanic\'', 'Vehicle issue', 'open-claim', 'send-claim-link', 'claimMatchNote', 'proofLine', 'Open proof', 'proof-line', 'mechanic?\'vehicle issues\'']);
assertIncludes('Dispute recovery bridge', disputeRecoveryBoard + disputeRecoveryIssue + app + css, ['Dispute / recovery bridge', 'Needs customer/payment match', 'Ready to collect', 'Proof needed', 'Deadline soon', 'API/provider needed', 'Clover disputes', 'tolls, violations', 'reimbursements', 'open-api-provider', 'send-claim-link', 'apply-claim-match', 'Star can draft the customer text', 'dispute-recovery-board', 'dispute-recovery-grid', 'dispute-recovery-card']);
assertIncludes('Tracker health layer', trackerStatus + app, ['Tracker offline', 'Tracker stale', 'Tracker setup', 'trackerLastPing', 'trackerLocation']);
assertIncludes('Staff fleet tracker cards', staffFleetCard, ['vehicleTrackingBadge', 'vehicleTrackingLine', 'Assignment conflict', 'compact-conflict', 'Claimed by']);
assertIncludes('Star QA truth-layer checks', starHealth + app, ['Autopay vehicle link', 'missingVehicle', 'Vehicle assignment conflicts', 'assignmentConflicts', 'Open payment links', 'Open card setup links', 'Pending Star approvals', 'openCardSetupLinks', 'pendingStarApprovals', 'Active autopay rows need car, VIN, tag, and tracker', 'Tracker review', 'Dispute match review', 'Toll/violation recovery', 'tollRecovery', 'API provider readiness', 'apiProviderReviewRows', 'Customer portal access', 'missingCustomerPortals', 'Sensitive changes', 'Verification inbox', 'Customer proof, paid-outside, service, toll, claim, and document reviews should be cleared before closeout', 'customer uploads stay pending until staff approves', 'starWebhookReadinessCards', 'SMS/email webhook secret', 'Clover webhook secret']);
assertIncludes('Star QA manager suggestions', starQaManager, ['Star QA manager', 'Fix first', 'Contact failed-twice customers', 'Review dispute matches', 'Review toll/violation recovery', 'Finish API provider readiness', 'Finish ', 'webhookCards', 'Resolve vehicle assignment conflicts', 'Link autopay to vehicles', 'Clear verification inbox', 'Create customer portal logins', 'Follow up open payment links', 'Verify customer uploads', 'Review today sensitive changes', 'Follow up card setup links', 'Approve pending Star work', 'card setup/change link(s) are still waiting', 'need admin approval or human review']);
assertIncludes('Star QA fallback report export', starExport + app, ['Customer portal access', 'missingCustomerPortalRecords', 'Toll/violation recovery', 'tollReview', 'API provider readiness', 'apiReview', 'Messaging webhook secret', 'Clover webhook secret', 'webhookSecretConfigured', 'need customer/vehicle/plate review before charge or message', 'Stale autopay schedules', 'Next run is before today with no paid/failed/setup status']);
assertIncludes('Operations queue assignment conflicts', operationsQueue, ['Assignment conflict', 'Claimed by', 'assignmentConflict', 'Resolve', 'view:"Operations"', 'tab:"Assigned"', 'SMS/email webhook secret', 'Clover webhook secret', 'WOA_MESSAGING_WEBHOOK_SECRET', 'WOA_CLOVER_WEBHOOK_SECRET']);
assertIncludes('Clover dispute match note', claimMatchNote, ['Needs payment/customer match', 'Matched: ', 'customerMatchSource', 'apply-claim-match', 'candidate.vin', 'candidate.plate', 'candidate.tracker', 'matchReason']);
assertIncludes('Star QA health panel', starHealth, ['Star QA', 'Missing VIN', 'Unmatched payments', 'Setup / not found', 'Open card setup links', 'Pending Star approvals', 'Provider setup needed before live SMS sends']);

const quickbar = finalFunctionSlice(app, 'mobileQuickbar');
assertStringsInclude('Mobile quickbar labels', quickbar, ['Dashboard', 'Payments', 'Operations', 'Messages', 'Settings', 'Manager Portal', 'Reports', 'Mechanic Portal', 'Maintenance', 'Fleet', 'Claims & Issues']);
assertExcludes('Mobile quickbar raw letter labels', quickbar, ["['Dashboard','D']", "['Payments','P']", "['Mechanic Portal','M']"]);

const nav = finalFunctionSlice(app, 'navForRole');
assertIncludes('Role navigation', nav, [
  "if(r==='mechanic')return['Mechanic Portal','Maintenance','Fleet','Claims & Issues']",
  "if(r==='manager')return['Manager Portal','Today','Customers','Applications','Operations','Fleet','Dispatch','Maintenance','Documents','Tolls','Insurance','Claims & Issues','Messages','Reports']"
]);

const localSearch = finalFunctionSlice(app, 'hydrateLocalSearches');
assertIncludes('Local section search', localSearch, ['.card.section', '.local-search', '.message-thread-grid', '.mechanic-cards']);

assertIncludes('Server email and Star backend', server, [
  '/api/webhooks/email',
  'sendProviderEmail',
  'api.resend.com/emails',
  'api.sendgrid.com/v3/mail/send',
  'futureChannels',
  'email when provider is connected',
  'Charges, card changes, autopay edits, removals, disputes, receipts after payment',
  'Star AI, the built-in WheelsonAuto AI manager'
]);

assertIncludes('Modal, mobile, and no-blur style surface', css, [
  'Final modal polish: keep every popup readable across admin, manager, mechanic, and public flows.',
  'Final no-blur pass: every staff information surface stays sharp on hover.',
  '.quickbar button span',
  '.message-thread-grid',
  '.staff-card-board',
  '.mechanic-workspace'
]);

console.log('View surface check passed: admin, manager, mechanic, mobile, modal/search, and Star email surfaces are wired.');
