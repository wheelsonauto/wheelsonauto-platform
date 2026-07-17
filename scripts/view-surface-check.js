const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const customerPortalClient = fs.readFileSync(path.join(root, 'customer-portal.js'), 'utf8');

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
  const match = render.match(/\(\{([^}]+)\}\[view\]\|\|Dashboard\)(?:\(\)|;)/);
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
  'paymentTruthQueueRows',
  'paymentTruthQueueBoard',
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

const paymentTruthQueueRows = finalFunctionSlice(app, 'paymentTruthQueueRows');
const paymentTruthQueueBoard = finalFunctionSlice(app, 'paymentTruthQueueBoard');
assertIncludes('Payments truth queue rows', paymentTruthQueueRows, [
  'Vehicle link',
  'VIN / tag / tracker',
  'Contact missing',
  'Payment not found',
  'Card setup',
  'Assignment conflict',
  'Unmatched payment',
  'Open card setup',
  'Portal login'
]);
assertIncludes('Payments truth queue board', paymentTruthQueueBoard + app, [
  'Data truth queue',
  'payment-truth-queue',
  'Fix these before charging, closeout, reports, tolls, claims, messages, or Star automation are trusted.',
  'Search truth queue by customer, VIN, tag, tracker, payment, setup, portal, or issue',
  'This queue is not a second customer list',
  '__woaPaymentsTruthQueueBase',
  'paymentTruthQueueBoard()'
]);

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

const reportCloseoutCommandItems = finalFunctionSlice(app, 'reportCloseoutCommandItems');
const reportCloseoutCommandBoard = finalFunctionSlice(app, 'reportCloseoutCommandBoard');
assertIncludes('Reports owner closeout command', reportCloseoutCommandItems + reportCloseoutCommandBoard + app + css, [
  'Owner closeout command',
  'End-of-day accounting, money gaps, failed payments, open links, Star approvals, proof, tolls, claims, service, and fleet conflicts',
  'closeoutSnapshot',
  'transactionCustomerName',
  'tollClaims',
  'customerMaintenanceJobs',
  'roleCommandCard',
  'Search closeout by money',
  'report-closeout-command',
  'report-closeout-grid'
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

const marketing = finalFunctionSlice(app, 'Marketing') + finalFunctionSlice(app, 'marketingLeadCommandItems') + finalFunctionSlice(app, 'marketingFollowupBoard') + app.slice(app.indexOf('var __woaMarketingFollowupBase=Marketing;'), app.indexOf('function ifleetFunctionCoverageItems'));
assertIncludes('Marketing surface', marketing, [
  'marketingLeadCommandItems',
  'marketingFollowupBoard',
  'Marketing command',
  'Lead follow-up command',
  'Lead adapter is live',
  'marketing-followup-board',
  'marketing-lead-card',
  'Conversion linked to customer file',
  'Lead board',
  'Search follow-up by customer, phone, email, car, source, campaign, status, or next step',
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
assertIncludes('Customer portal proof intake', customerPortalHtml + server + app + customerPortalClient + css, [
  '/customer/service-request',
  '/customer/issue-report',
  'data-customer-document-upload',
  'Choose secure file',
  'Upload securely',
  'customer-portal.js',
  'savePrivateDocument',
  'portalDownloadUrl',
  'privateFileAvailable',
  'View uploaded file',
  'customer-mobile-focused',
  '#portal-overview',
  "'#portal-payments': ['portal-payments', 'portal-payment-history']",
  'portal-mobile-visible',
  'customer-next-actions{display:none}',
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

const insurance = finalFunctionSlice(app, 'IntegratedInsurance');
assertIncludes('Insurance/background surface', insurance + app + server, [
  'Background checks',
  'backgroundCases',
  'missingBackground',
  'integrated-new-verification',
  'verificationEvidenceDocs',
  'verificationDocClearedForCustomer',
  'Background check not verified',
  'open-document',
  'Only last 4 will be stored',
  'WOA_BACKGROUND_PROVIDER',
  '/api/verification/cases',
  '/api/webhooks/verification'
]);

const auditTrailPanel = finalFunctionSlice(app, 'auditTrailPanel');
assertIncludes('Owner audit trail surface', auditTrailPanel + app + server, [
  'Audit trail',
  'Owner-only history',
  'appendAuditLog',
  'auditChangedSections',
  'delete safe.auditLogs'
]);

assertIncludes('Tracker provider-neutral adapter', app + server, [
  'WOA_TRACKER_PROVIDER',
  'WOA_TRACKER_WEBHOOK_SECRET',
  '/api/integrations/tracker/status',
  '/api/integrations/tracker/sync',
  '/api/webhooks/tracker',
  'Missing file',
  'scrubPreciseTrackerLocation'
]);

assertIncludes('Marketing provider-neutral adapter', app + server, [
  'WOA_MARKETING_PROVIDER',
  'WOA_MARKETING_WEBHOOK_SECRET',
  '/api/integrations/marketing/status',
  '/api/integrations/marketing/sync',
  '/api/webhooks/marketing',
  'applyMarketingLead',
  'duplicate protection',
  'exact application/customer/vehicle linking'
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
assertIncludes('Weak vehicle display guard', app, [
  'function usableVehicleLabel',
  "text.replace(/[$,\\s]/g,'')",
  "saved||'No vehicle linked'",
  'paymentVehicleInfo=function'
]);

const paymentCustomerCard = finalFunctionSlice(app, 'paymentCustomerCard');
assertIncludes('Customer payment/history cards', paymentCustomerCard, [
  'historyChargeButtons',
  'textCustomerButton',
  'customerFileInline',
  'actionMenu',
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
const serviceRouteItems = finalFunctionSlice(app, 'serviceRouteItems');
const serviceRouteBoard = finalFunctionSlice(app, 'serviceRouteBoard');
assertIncludes('Maintenance surface', maintenance, [
  'Open',
  'Overdue',
  'Monthly',
  'Completed',
  'staffServiceCard',
  'serviceRouteBoard',
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
assertIncludes('Service route board', serviceRouteItems + serviceRouteBoard + maintenance + css, [
  'Service route',
  'Next shop work in order',
  'overdue',
  'due today',
  'monthly/oil cycle',
  'vehicleIdentityLine',
  'complete-maintenance',
  'open-maintenance',
  'open-vehicle',
  'customerFileButton',
  'Search service route by customer',
  'service-route-board',
  'service-route-grid',
  'service-route-card'
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
const messagesFocused = finalFunctionSlice(app, 'MessagesFocused');
const communicationCommandItems = finalFunctionSlice(app, 'communicationCommandItems');
const communicationCommandBoard = finalFunctionSlice(app, 'communicationCommandBoard');
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
assertIncludes('Focused Messages workspace', messagesFocused + app + css, [
  'messageFocusedTabs',
  'message-inbox-shell',
  'messageFocusedConversation',
  'messageFocusedStarWorkspace',
  'messageFocusedQueueWorkspace',
  'messageFocusedTemplatesWorkspace',
  'messageFocusedHistoryWorkspace',
  'message-mobile-thread-open',
  'message-mobile-back',
  'Showing the latest ',
  'Sensitive payment and account changes still need admin approval.'
]);
assertIncludes('Communication command board', messages + communicationCommandItems + communicationCommandBoard + app + css, [
  'Communication command',
  'Texts, emails, Star approvals, portal requests, failed payments, service reminders, receipts, and customer replies',
  'fastMessageQueueRows',
  'starQaPendingApprovalRows',
  'customerPortalRequestItems',
  'fastMessageThreads',
  'roleCommandCard',
  'Provider setup remains honest',
  'Search communication command by customer',
  'communication-command-board',
  'communication-command-grid'
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

const applicationHandoffItems = finalFunctionSlice(app, 'applicationHandoffItems');
const applicationHandoffBoard = finalFunctionSlice(app, 'applicationHandoffBoard');
assertIncludes('Application approval handoff board', applicationHandoffItems + applicationHandoffBoard + app + css, [
  'Approval handoff',
  'Approved applicants must move cleanly',
  'approval message',
  'customer file',
  'vehicle link',
  'autopay row',
  'portal login',
  'insurance proof',
  'background proof',
  'send-approval',
  'contract-app',
  'open-contract',
  'application-handoff-board',
  'application-handoff-grid',
  'application-handoff-card'
]);

const customerPortalRequestItems = finalFunctionSlice(app, 'customerPortalRequestItems');
const customerPortalRequestsBoard = finalFunctionSlice(app, 'customerPortalRequestsBoard');
assertIncludes('Customer portal request board', customerPortalRequestItems + customerPortalRequestsBoard + app + css, [
  'Customer portal requests',
  'receipt',
  'cardSetupRequests',
  'paymentRequests',
  'Proof upload',
  'Service request',
  'Issue report',
  'Search portal requests by customer',
  'compose-message',
  'open-document',
  'customer-portal-requests-board',
  'customer-portal-request-grid',
  'customer-portal-request-card'
]);

const portalVerificationCommandItems = finalFunctionSlice(app, 'portalVerificationCommandItems');
const portalVerificationCommandBoard = finalFunctionSlice(app, 'portalVerificationCommandBoard');
assertIncludes('Portal verification command board', portalVerificationCommandItems + portalVerificationCommandBoard + app + css, [
  'Portal intake & verification',
  'verificationInboxItems',
  'customerPortalRequestItems',
  'paid outside',
  'card setup',
  'Search portal intake by customer',
  'data-view="Messages"',
  'data-view="Documents"',
  'portal-verification-command',
  'portal-verification-grid',
  'portal-verification-card'
]);

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
const starAuditor = finalFunctionSlice(app, 'starSystemAuditorBoard') + finalFunctionSlice(app, 'starSystemAuditItems') + finalFunctionSlice(app, 'starAuditTaskPayload');
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
assertIncludes('Star OpenAI setup card', app + starReadiness, [
  'star-openai-setup-card',
  'OpenAI Responses API connected',
  'OPENAI_API_KEY or WOA_OPENAI_API_KEY',
  'WOA_AI_MODEL',
  'Default model: gpt-5.4-nano',
  'Test does not send texts, charge cards, or change accounts'
]);
assertIncludes('Star system auditor', starAuditor + app + css, [
  'Star system auditor',
  'bugs, weak links, API blockers',
  'Create review tasks',
  'create-star-audit-task',
  'create-all-star-audit-tasks',
  'Star audit:',
  'star-audit-grid',
  'star-audit-card',
  'Dispatch work',
  'admin approval'
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
const customerPortalCommandBoard = finalFunctionSlice(app, 'customerPortalCommandBoard');
const customerPortalButton = finalFunctionSlice(app, 'customerPortalButton');
const paymentCustomerPortalCard = finalFunctionSlice(app, 'paymentCustomerCard');
const recurringCardActionButtons = finalFunctionSlice(app, 'cardActionButtons');
const customerVehicleTextGaps = finalFunctionSlice(app, 'customerVehicleTextGaps');
assertIncludes('Settings customer portal accounts', settings, ['Customer portal logins', 'new-customer-login', '/customer/login']);
assertIncludes('Customer portal command board', customerPortalCommandBoard + settings + app + css, ['Customer portal command', 'Login ready', 'Needs password', 'Active gaps', 'Reset requested', 'Card setup links', 'Portal messages', 'Proof uploads', 'Disabled logins', 'Customer portal access is scoped', 'customer-portal-command-board', 'customer-portal-command-grid', 'customer-portal-command-card']);
assertIncludes('Settings staff password help', settings + server, ['Staff accounts', 'Reset requested', 'staff_password_reset', '/forgot', 'Reset staff access']);
assertIncludes('Company account staff actions', organizations + companyFoundationPanel + companyLaunchBoard + companyReadinessCards + app + css, ['Company accounts', 'Franchise readiness', 'Staff scoping', 'isolated database storage', 'per-company', 'Data scope', 'API key mode', 'Tenant readiness', 'Subscriber locked', 'Add staff', 'new-staff', 'Staff list', 'company-scoped workspace', 'Subscriber mode needs final API separation', 'Company launch guardrails', 'Internal store mode', 'Staff scoped access', 'Customer portal scope', 'Subscriber accounts', 'Per-company API keys', 'Billing connected', 'Owner audit + reports', 'company-launch-board', 'company-launch-grid', 'company-launch-card']);
const coreSystemItems = finalFunctionSlice(app, 'coreSystemItems');
const coreSystemBoard = finalFunctionSlice(app, 'coreSystemBoard');
const ifleetFunctionCoverageItems = finalFunctionSlice(app, 'ifleetFunctionCoverageItems');
const ifleetFunctionCoverageBoard = finalFunctionSlice(app, 'ifleetFunctionCoverageBoard');
const ifleetCoverageTaskRows = finalFunctionSlice(app, 'ifleetCoverageTaskRows');
const ifleetCoverageTaskCards = finalFunctionSlice(app, 'ifleetCoverageTaskCards');
const ifleetCoverageTaskBoard = finalFunctionSlice(app, 'ifleetCoverageTaskBoard');
const ifleetTaskGuidance = finalFunctionSlice(app, 'ifleetTaskGuidance');
const ifleetLaunchProofItems = finalFunctionSlice(app, 'ifleetLaunchProofItems');
const ifleetLaunchProofBoard = finalFunctionSlice(app, 'ifleetLaunchProofBoard');
const ifleetNextCommandItems = finalFunctionSlice(app, 'ifleetNextCommandItems');
const ifleetNextCommandBoard = finalFunctionSlice(app, 'ifleetNextCommandBoard');
const launchReadinessSummaryItems = finalFunctionSlice(app, 'launchReadinessSummaryItems');
const launchReadinessSummaryBoard = finalFunctionSlice(app, 'launchReadinessSummaryBoard');
const apiOperationalItems = finalFunctionSlice(app, 'apiOperationalItems');
const apiOperationalBoard = finalFunctionSlice(app, 'apiOperationalBoard');
const apiProviderLaunchItems = finalFunctionSlice(app, 'apiProviderLaunchItems');
const apiProviderLaunchQueue = finalFunctionSlice(app, 'apiProviderLaunchQueue');
const apiHandoffChecklistRows = finalFunctionSlice(app, 'apiHandoffChecklistRows');
const apiHandoffChecklistBoard = finalFunctionSlice(app, 'apiHandoffChecklistBoard');
assertIncludes('Core system board', coreSystemBoard + coreSystemItems, ['Core system board', 'iFleet-style operating system', 'Payment/autopay engine', 'Customer + fleet truth', 'Messages + Star', 'Customer portal', 'Tolls/violations/recovery', 'Claims + disputes', 'Franchise/company base', 'API-ready layer', 'Manual-live', 'Draft-live']);
assertIncludes('iFleet coverage command map', ifleetFunctionCoverageItems + ifleetFunctionCoverageBoard + app + css, ['iFleet function coverage', 'Every operations function we talked about', 'Applications + approvals', 'Customer operating file', 'Autopay + closeout', 'Fleet assignment', 'Inspections + shop work', 'Tolls + violations', 'Claims + disputes', 'Documents + proof', 'Insurance/background', 'Messaging + Star', 'Dispatch/work orders', 'Reports/accounting', 'Role portals', 'Customer portal', 'Marketing/leads', 'Franchise/company', 'API provider layer', 'sync-ifleet-coverage-tasks', '/api/system/ifleet-coverage/tasks', 'Sync tasks creates one Dispatch item per backend coverage gap', 'ifleet-coverage-board', 'ifleet-coverage-grid', 'ifleet-coverage-card']);
assertIncludes('iFleet coverage fallback report', app, ['__woaReportCsvRowsIfleetCoverageBase', 'Frontend fallback report', "reportRow(rows,'iFleet function coverage'"]);
assertIncludes('Dispatch iFleet coverage work board', ifleetCoverageTaskRows + ifleetCoverageTaskCards + ifleetCoverageTaskBoard + app + css, ['iFleet coverage work', 'Backend coverage gaps are real Dispatch work now', 'ifleet-coverage-work-board', 'ifleet-coverage-work-grid', 'task-ifleet-coverage-', "type==='ifleet coverage'", 'Open task', 'Sync tasks', 'These are not fake tabs']);
assertIncludes('iFleet task modal guidance', ifleetTaskGuidance + app + css, ['iFleet coverage task', 'ifleet-task-guidance', 'iFleet coverage', 'iFleet tightening', 'Launch proof', 'Star audit', 'Readiness', 'API setup', '__woaTaskFormCoverageBase']);
assertIncludes('iFleet launch proof board', ifleetLaunchProofItems + ifleetLaunchProofBoard + app + css, ['Launch proof board', 'Final iFleet-style tightening checklist', 'Payment/autopay lock', 'Customer/fleet truth', 'Customer portal', 'Applications + approvals', 'Inspections + mechanic work', 'Tolls, claims, disputes', 'Documents + verification', 'Fleet availability', 'Franchise/company base', 'API provider layer', 'ifleet-launch-proof-board', 'ifleet-launch-proof-grid', 'ifleet-launch-proof-card']);
assertIncludes('Dashboard iFleet next command board', ifleetNextCommandItems + ifleetNextCommandBoard + app + css, ['Next build command', 'iFleet-level functions, Star audit risks, provider setup, and operations gaps', 'create-ifleet-next-task', 'iFleet tightening task added to Dispatch', 'ifleet-next-board', 'ifleet-next-grid', 'ifleet-next-card']);
assertIncludes('Owner launch readiness summary', launchReadinessSummaryItems + launchReadinessSummaryBoard + app + server + css, ['Launch readiness', 'Owner-level summary of the core system', 'Payments/autopay lock', 'Customer + fleet truth', 'Defense packets', 'Recovery ledger', 'Messages + Star rules', 'API handoff', 'Roles + portals', 'Search launch readiness by payment', 'compass, not a duplicate workspace', 'Launch readiness', 'Owner summary', 'sync-launch-readiness-tasks', '/api/system/launch-readiness/tasks', 'Launch readiness Dispatch task sync']);
assertIncludes('API operating bridge', apiOperationalItems + apiOperationalBoard + app + css, ['API operating bridge', 'All iFleet-style provider functions', 'APIs plug in last', 'Clover disputes + refunds', 'Saved-card charges', 'EZPass/tolls + violations', 'SMS/email messaging', 'Insurance/background checks', 'Tracker/location', 'Accounting + closeout exports', 'Franchise / multi-company', 'Works now:', 'API unlocks:', 'Must match:', 'api-operational-board', 'api-operational-grid', 'api-operational-card']);
assertIncludes('API provider launch queue', apiProviderLaunchItems + apiProviderLaunchQueue + app + css, ['Provider launch queue', 'API work order list', 'Search providers by Clover, SMS, email, EZPass', 'Choose provider, collect credentials', 'Run controlled live test and save date + result', 'lastTestAt', 'API must match:', 'Next:', 'open-api-provider', 'create-api-task', 'api-provider-launch-queue', 'api-provider-launch-grid', 'api-provider-launch-card']);
assertIncludes('API handoff checklist', apiHandoffChecklistRows + apiHandoffChecklistBoard + app + css, ['API handoff checklist', 'Before any provider goes live', 'data it touches', 'fallback workflow', 'endpoint/webhook', 'live test', 'last result', 'owner approval path', 'apiHandoffDataMap', 'customers, payments, transactions', 'Drafts save in Messages until provider is live', 'Manual workflow stays active until API proves matching and reports', 'Search API handoff by provider', 'no provider is trusted just because a key exists', 'API handoff checklist', 'API handoff']);
assertIncludes('Customer portal account form', customerLoginForm, ['customerLoginName', 'customerLoginPassword', 'customerLoginRecurringId', 'customerLoginVehicleId']);
assertIncludes('Customer portal action helper', customerPortalButton, ['open-customer-login', 'new-customer-login', 'data-name']);
assertIncludes('Payment customer portal card actions', paymentCustomerPortalCard, ['customerPortalButton', 'Portal']);
assertIncludes('Recurring customer portal card actions', recurringCardActionButtons, ['customerPortalButton', 'Portal']);
assertIncludes('Customer vehicle text truth layer', customerVehicleTextGaps + app, ['Customer vehicle text', 'not linked to a real fleet vehicle', 'Open the file and choose the correct car by VIN/tag/tracker', 'Customer records where vehicle text does not match a linked fleet vehicle']);

const staffServiceCard = finalFunctionSlice(app, 'staffServiceCard');
const staffClaimCard = finalFunctionSlice(app, 'staffClaimCard');
const claimMatchNote = finalFunctionSlice(app, 'claimMatchNote');
const disputeRecoveryBoard = finalFunctionSlice(app, 'disputeRecoveryBoard');
const disputeRecoveryIssue = finalFunctionSlice(app, 'disputeRecoveryIssue');
const disputeEvidenceBoard = finalFunctionSlice(app, 'disputeEvidenceBoard');
const disputeIdentityResolverItems = finalFunctionSlice(app, 'disputeIdentityResolverItems');
const disputeIdentityResolverBoard = finalFunctionSlice(app, 'disputeIdentityResolverBoard');
const claimDefensePacketRows = finalFunctionSlice(app, 'claimDefensePacketRows');
const claimDefensePacketBoard = finalFunctionSlice(app, 'claimDefensePacketBoard');
const reimbursementLedgerRows = finalFunctionSlice(app, 'reimbursementLedgerRows');
const reimbursementLedgerBoard = finalFunctionSlice(app, 'reimbursementLedgerBoard');
const tollsView = finalFunctionSlice(app, 'Tolls');
const tollRouteItems = finalFunctionSlice(app, 'tollRecoveryRouteItems');
const tollRouteBoard = finalFunctionSlice(app, 'tollRecoveryRouteBoard');
const starHealth = finalFunctionSlice(app, 'starSystemHealthPanelFresh') || finalFunctionSlice(app, 'starSystemHealthPanel');
const starQaManager = (finalFunctionSlice(app, 'starQaManagerPanel') || '') + (finalFunctionSlice(app, 'starQaManagerPanelFresh') || '');
const starExport = finalFunctionSlice(app, 'starSystemHealthExport');
const trackerStatus = finalFunctionSlice(app, 'vehicleTrackingStatus');
const staffFleetCard = finalFunctionSlice(app, 'staffFleetCard');
const operationsQueue = finalFunctionSlice(app, 'operationsQueue');
const dispatchView = finalFunctionSlice(app, 'Dispatch');
const dispatchCommandItems = finalFunctionSlice(app, 'dispatchCommandItems');
const dispatchCommandBoard = finalFunctionSlice(app, 'dispatchCommandBoard');
assertIncludes('Dispatch command board', dispatchView + dispatchCommandItems + dispatchCommandBoard + app + css, ['Dispatch command', 'Work orders from tasks', 'operationsQueue', 'verificationInboxItems', 'tollRecoveryRouteItems', 'apiProviderReviewRows', 'roleCommandCard', 'create-api-task', 'complete-task', 'Search dispatch by customer', 'dispatch-command-board']);
const lifecycleCommandItems = finalFunctionSlice(app, 'lifecycleCommandItems');
const lifecycleCommandBoard = finalFunctionSlice(app, 'lifecycleCommandBoard');
assertIncludes('Operations lifecycle command board', operations + lifecycleCommandItems + lifecycleCommandBoard + app + css, ['Lifecycle command', 'Application, approval, customer file, autopay, vehicle assignment, service, recovery, return, and history', 'applicationHandoffItems', 'recurringRoster', 'serviceRouteItems', 'tollRecoveryRouteItems', 'paymentCustomerRecords', 'roleCommandCard', 'open-contract-for-name', 'Search lifecycle by customer', 'lifecycle-command-board', 'lifecycle-command-grid']);
const returnPrepCommandItems = finalFunctionSlice(app, 'returnPrepCommandItems');
const returnPrepCommandBoard = finalFunctionSlice(app, 'returnPrepCommandBoard');
assertIncludes('Operations return prep command board', operations + returnPrepCommandItems + returnPrepCommandBoard + app + css, ['Return & prep command', 'Returned customers, stale assignments, ready/prep cars', 'returnVehicleToFleet', 'stopCustomerAutopayForReturn', 'paymentCustomerRecords', 'inLotMaintenanceJobs', 'Returned car still assigned', 'History customer still assigned', 'Open prep', 'Search return/prep by customer', 'return-prep-command-board', 'return-prep-grid']);
const safeRenderRecovery = finalFunctionSlice(app, 'safeRenderRecovery');
assertIncludes('Safe render recovery guard', safeRenderRecovery + app + css, ['Tab recovery', 'This tab hit a display error', '__woaSafeRenderBase', 'window.__woaLastUiError', 'window.addEventListener(\'error\'', 'unhandledrejection', 'data-action="refresh-data"', 'render-recovery-panel', 'render-recovery-actions']);
const messageCommandPanel = finalFunctionSlice(app, 'messageCommandPanel');
assertIncludes('Messages command panel', messageCommandPanel + app + css, ['Message command', 'Real SMS/email inbox workflow', 'New text/email', 'Ask Star', 'Provider mode', 'Texts save as drafts until hosted SMS is connected', 'Emails save as drafts until Resend/SendGrid is connected', 'message-command-panel', 'message-command-grid', 'message-command-current']);
const communicationRuleRows = finalFunctionSlice(app, 'communicationRuleRows');
const communicationRulesBoard = finalFunctionSlice(app, 'communicationRulesBoard');
assertIncludes('Communication automation rules', communicationRuleRows + communicationRulesBoard + app + css, ['Communication rules', 'What Star, SMS, email, manager, and admin are allowed to do', 'Payment due today', 'Failed twice / contact', 'Card setup or change', 'Maintenance reminder', 'Toll / claim recovery', 'Application approved', 'Daily closeout', 'Customer portal inbound', 'messages save as drafts/history', 'money, cards, disputes, removals, refunds, receipts, and closeout signoff stay admin-confirmed', 'communication-rules-board', 'Communication rules', 'SMS provider setup', 'Email provider setup', 'Star provider setup']);
assertIncludes('Staff service cards', staffServiceCard + app + css, ['roleName()===\'mechanic\'', 'vehicleIdentityLine', 'complete-maintenance', 'open-maintenance', 'proofLine', 'Open proof', 'proof-line']);
assertIncludes('Staff claim cards', staffClaimCard + app + css, ['isMechanicVisibleClaim', 'roleName()===\'mechanic\'', 'Vehicle issue', 'open-claim', 'send-claim-link', 'claimMatchNote', 'proofLine', 'Open proof', 'proof-line', 'mechanic?\'vehicle issues\'']);
assertIncludes('Dispute recovery bridge', disputeRecoveryBoard + disputeRecoveryIssue + app + css, ['Dispute / recovery bridge', 'Needs customer/payment match', 'Ready to collect', 'Proof needed', 'Deadline soon', 'API/provider needed', 'Clover disputes', 'tolls, violations', 'reimbursements', 'open-api-provider', 'send-claim-link', 'apply-claim-match', 'Star can draft the customer text', 'dispute-recovery-board', 'dispute-recovery-grid', 'dispute-recovery-card']);
assertIncludes('Dispute evidence package', disputeEvidenceBoard + app + css, ['Dispute evidence package', 'Chargebacks and Clover disputes', 'Need customer/payment', 'Proof missing', 'Deadline soon', 'Ready package', 'Search disputes by Clover case', 'claimHasProof', 'claimDeadlineSoon', 'apply-claim-match', 'If Clover sends a dispute without a customer name']);
assertIncludes('Claim and dispute defense packet', claimDefensePacketRows + claimDefensePacketBoard + app + css, ['Defense packet', 'One packet per toll, claim, reimbursement, Clover dispute, or chargeback', 'customer, payment ID, vehicle, VIN/tag, tracker, proof, amount, and follow-up', 'claimDefensePacketRows', 'claimDefensePacketBoard', 'claim-defense-packet-board', 'Search defense packets by customer', 'Clover/payment ID', 'proof/reference', 'send-claim-link', 'apply-claim-match', 'Defense packets', 'Claims/disputes/tolls', 'Star system auditor']);
assertIncludes('Recovery and reimbursement ledger', reimbursementLedgerRows + reimbursementLedgerBoard + app + css, ['Recovery ledger', 'Tolls, violations, damage, reimbursements, disputes, and chargebacks', 'amount, paid, and still owed', 'reimbursementLedgerRows', 'reimbursementLedgerBoard', 'reimbursement-ledger-board', 'Search recovery ledger by customer', 'Needs match', 'Recovered', 'Still owed', 'send-claim-link', 'mark-claim-paid', 'Recovery ledger', 'Star system auditor']);
assertIncludes('Dispute identity resolver', disputeIdentityResolverItems + disputeIdentityResolverBoard + app + css, ['Dispute identity resolver', 'Name-missing disputes', 'unmatched Clover transactions', 'Search identity resolver by customer, payment ID, Clover case', 'transactionPossibleMatches', 'apply-transaction-match', 'apply-claim-match', 'do not answer a dispute', 'dispute-identity-resolver', 'dispute-identity-grid', 'dispute-identity-card']);
assertIncludes('Tolls command view', tollsView + app + css, ['Toll recovery command', 'Open recovery', 'Missing file', 'Ready to collect', 'EZPass API', 'Accounting', 'Search tolls by customer', 'toll-recovery-list', 'toll-recovery-card', 'new-toll-import', 'new-toll', 'send-claim-link', 'mark-claim-paid', 'Provider setup', 'Star can draft toll/violation messages']);
assertIncludes('Toll follow-up route', tollRouteItems + tollRouteBoard + tollsView + css, ['Toll follow-up route', 'Work these in order', 'match customer/car', 'review proof', 'send recovery link', 'claimHasProof', 'apply-claim-match', 'send-claim-link', 'mark-claim-paid', 'Search toll route by customer', 'toll-route-board', 'toll-route-grid', 'toll-route-card']);
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
assertIncludes('Frontend staff status helper', app, ['function staffStatusActive(staff)', 'disabled|removed|closed|inactive']);
assertIncludes('Role navigation', nav, [
  "if(r==='mechanic')return['Mechanic Portal','Maintenance','Fleet','Claims & Issues','Settings']",
  "if(r==='manager')return['Manager Portal','Today','Customers','Applications','Operations','Fleet','Dispatch','Maintenance','Documents','Tolls','Insurance','Claims & Issues','Messages','Reports','Settings']"
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
  'Star AI, the built-in WheelsonAuto AI manager',
  'portalAccount',
  'paymentRequests',
  'cardSetupRequests',
  'recentMessages',
  'contract_esign_request',
  'portal_login_help',
  'contract/e-sign send',
  'password reset',
  'customer, vehicle, VIN/tag, tracker, payment state, portal, documents, applications, service, tolls/claims, tasks, recent messages, launch readiness gaps, and iFleet coverage gaps'
]);

assertIncludes('Physical pickup completion handoff', app + server, [
  'integrated-open-pickup-completion',
  'integrated-save-pickup-completion',
  'Starting mileage at handoff',
  '/api/pickups/',
  '/complete',
  'Customer pickup completed',
  'Approved - vehicle picked up',
  "status: 'Rented'",
  "status: 'Active'"
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
