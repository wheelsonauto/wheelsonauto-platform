const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const cardSetup = fs.readFileSync(path.join(root, 'card-setup.js'), 'utf8');

function fail(message) {
  throw new Error(message);
}

if (!app.includes('async function action(a,id,el){var b=el;')) {
  fail('The shared action handler must bind the clicked button before async UI actions run.');
}

function unique(matches, map) {
  return [...new Set([...matches].map(map).filter(Boolean))].sort();
}

function functionSlice(name) {
  let start = -1;
  let cursor = 0;
  while (true) {
    const next = app.indexOf('function ' + name + '(', cursor);
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const argsClose = app.indexOf(')', start);
  const open = app.indexOf('{', argsClose > -1 ? argsClose : start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    const char = app[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  return '';
}

function topLevelFunctionNames() {
  const names = [];
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < app.length; index += 1) {
    const char = app[index];
    const next = app[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (!app.startsWith('function ', index)) continue;
    const match = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(app.slice(index, index + 160));
    if (!match) continue;
    const argsOpen = index + app.slice(index).indexOf('(');
    let cursor = argsOpen;
    let parenDepth = 0;
    for (; cursor < app.length; cursor += 1) {
      const token = app[cursor];
      if (token === '(') parenDepth += 1;
      else if (token === ')') {
        parenDepth -= 1;
        if (parenDepth === 0) break;
      }
    }
    const open = app.indexOf('{', cursor);
    if (open < 0) fail('Could not parse top-level function: ' + match[1]);
    let depth = 0;
    let innerQuote = '';
    let innerEscaped = false;
    let innerLineComment = false;
    let innerBlockComment = false;
    let end = -1;
    for (let bodyIndex = open; bodyIndex < app.length; bodyIndex += 1) {
      const token = app[bodyIndex];
      const after = app[bodyIndex + 1];
      if (innerLineComment) {
        if (token === '\n') innerLineComment = false;
        continue;
      }
      if (innerBlockComment) {
        if (token === '*' && after === '/') {
          innerBlockComment = false;
          bodyIndex += 1;
        }
        continue;
      }
      if (innerQuote) {
        if (innerEscaped) innerEscaped = false;
        else if (token === '\\') innerEscaped = true;
        else if (token === innerQuote) innerQuote = '';
        continue;
      }
      if (token === '/' && after === '/') {
        innerLineComment = true;
        bodyIndex += 1;
        continue;
      }
      if (token === '/' && after === '*') {
        innerBlockComment = true;
        bodyIndex += 1;
        continue;
      }
      if (token === '"' || token === "'" || token === '`') {
        innerQuote = token;
        continue;
      }
      if (token === '{') depth += 1;
      else if (token === '}') {
        depth -= 1;
        if (depth === 0) {
          end = bodyIndex + 1;
          break;
        }
      }
    }
    if (end < 0) fail('Could not parse top-level function: ' + match[1]);
    names.push(match[1]);
    index = end - 1;
  }
  return names;
}

function actionSlice(action) {
  const needles = [
    "a==='" + action + "'",
    'a==="' + action + '"',
    "b.dataset.action==='" + action + "'",
    'b.dataset.action==="' + action + '"',
    "b.dataset.action!=='" + action + "'",
    'b.dataset.action!=="' + action + '"',
    "actionName==='" + action + "'",
    'actionName==="' + action + '"'
  ];
  let index = -1;
  for (const needle of needles) index = Math.max(index, app.lastIndexOf(needle));
  if (index < 0) return '';
  return app.slice(Math.max(0, index - 2200), Math.min(app.length, index + 5200));
}

function assertIncludes(label, source, required) {
  if (!source) fail(label + ' block was not found.');
  const missing = required.filter(text => !source.includes(text));
  if (missing.length) fail(label + ' is missing: ' + missing.join(', '));
}

function assetVersions(source, asset) {
  return unique(source.matchAll(new RegExp('/' + asset.replace('.', '\\.') + '\\?v=([^"\']+)', 'g')), match => match[1]);
}

const indexCssVersions = assetVersions(indexHtml, 'styles.css');
const indexAppVersions = assetVersions(indexHtml, 'app.js');
if (indexCssVersions.length !== 1) fail('index.html should reference exactly one styles.css asset version.');
if (indexAppVersions.length !== 1) fail('index.html should reference exactly one app.js asset version.');
if (indexCssVersions[0] !== indexAppVersions[0]) {
  fail('index.html styles.css and app.js should share the same cache-busting version.');
}
if (indexHtml.includes('platform-20260711-public-qa') || server.includes('platform-20260711-public-qa')) {
  fail('Stale public QA asset version is still referenced.');
}
assertIncludes('Server CSS cache-busting link', server, [
  "const ASSET_VERSION = '" + indexCssVersions[0] + "'",
  "const CSS_LINK = '<link rel=\"stylesheet\" href=\"/styles.css?v=' + ASSET_VERSION + '\">';"
]);
assertIncludes('Versioned static asset caching', server, ['staticFile(req, res, pathname, searchParams)', 'public, max-age=31536000, immutable', "? 'public, max-age=31536000, immutable'", ": 'no-store'", "Vary: 'Accept-Encoding'", "'Content-Encoding'"]);
assertIncludes('Native public journey no-store headers', server, ["nativeSite.homeHtml", "nativeSite.inventoryHtml", "nativeSite.applicationHtml", "'Cache-Control': 'no-store'"]);
assertIncludes('Authenticated app shell no-store headers', server, ["appHtml({ publicMode: false, user })", "'Cache-Control': 'no-store'"]);
assertIncludes('Session cookie security flags', server, ['function cookieSecurityFlags', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure']);
assertIncludes('Staff session cookie helper usage', server, ["sessionSetCookie('woa_session'", "sessionSetCookie('woa_customer_session'"]);
assertIncludes('Signed session cookies', server, ['SESSION_SIGNING_SECRET', 'SESSION_SIGNING_SECRET_CONFIGURED', 'sessionSignature', 'signedSessionCookie', 'verifySignedSessionCookie', "signedSessionCookie('staff'", "signedSessionCookie('customer'", "createHmac('sha256'"]);
assertIncludes('Expiring signed sessions', server, ['STAFF_SESSION_TTL_SECONDS', 'CUSTOMER_SESSION_TTL_SECONDS', 'sessionTtlSeconds', 'iat: issuedAt', 'exp: expiresAt', 'Number(session.exp) <= now']);
assertIncludes('Browser content security policy', server, ['function contentSecurityPolicy', "default-src 'self'", "script-src 'self' 'unsafe-inline' https://*.clover.com", "frame-src https://*.clover.com", "form-action 'self' https://*.clover.com", "upgrade-insecure-requests", "'Origin-Agent-Cluster': '?1'", "'X-Permitted-Cross-Domain-Policies': 'none'"]);
assertIncludes('Durable login throttling guard', server, ['rateLimitSecret: SESSION_SIGNING_SECRET', 'STATE_REPOSITORY.checkRateLimit', 'STATE_REPOSITORY.consumeRateLimit', 'STATE_REPOSITORY.clearRateLimit', 'LOGIN_THROTTLE_LIMIT', 'loginThrottleKey', 'loginThrottleWaitMs', 'recordLoginFailure', 'clearLoginFailure', 'Retry-After', 'Too many failed login attempts']);
assertIncludes('Durable public submission protection', server, ['await publicActionLimit', 'STATE_REPOSITORY.consumeRateLimit', 'PUBLIC_APPLICATION_LIMIT', 'PUBLIC_APPLICATION_DUPLICATE_MS', 'publicActionLimit', 'Too many application attempts', 'This application was already received.', "forwarded[forwarded.length - 1]"]);
if (/readBody\(req\)/.test(server) || /JSON\.parse\(await readBody/.test(server)) {
  fail('Every request body must use an explicit size ceiling and structured JSON parser.');
}
assertIncludes('Bounded request parsers', server, ['readBody(req, 64 * 1024)', 'readJsonBody(req, 32 * 1024 * 1024)', 'Request is larger than the allowed secure upload size.', 'Request body must be valid JSON.']);
assertIncludes('Single public application entry point', server, ["url.pathname === '/apply'", "Location: '/inventory'", "url.pathname.startsWith('/apply/')"]);
if (/staticFile[\s\S]{0,900}ifleet-prototype\.html/.test(server)) {
  fail('The obsolete iFleet prototype must not be publicly served as a static application surface.');
}
assertIncludes('Stale staff Apply state recovery', app, ["if(view==='Apply')view=isPublic?'Apply':'Website'"]);
assertIncludes('Owner live launch preflight surface', app, [
  'open-live-launch-preflight',
  '/api/system/infrastructure/preflight',
  'Controlled Stripe launch preflight',
  'Database credential isolation',
  'Clover cutover roster',
  'Clover cutover review',
  'liveLaunchCloverQuarantineReview',
  'missing_clover_subscription_id',
  'duplicate_clover_subscription_id',
  'missing_customer_identity',
  'WheelsonAuto will not stop Clover, merge plans, or guess a customer assignment from a name.',
  'PostgreSQL recovery drill',
  'Encrypted offsite backup',
  'create-state-backup',
  '/api/system/infrastructure/state-backup/create',
  'Stripe account',
  'check-stripe-readiness',
  '/api/integrations/stripe/readiness',
  'Telnyx SMS',
  'Resend email',
  'Star AI',
  'Recent job failures',
  'Vehicle identity review',
  'VIN review'
]);
assertIncludes('Launch summary text hierarchy', functionSlice('liveLaunchPreflightModal'), ['<span>Controlled Stripe launch</span><b>', "ready?'Clear':'Blocked'", 'Keep Clover live until every gate is verified.']);
assertIncludes('Owner recovery operator surface', app, [
  'open-recovery-console',
  '/api/system/recovery/snapshots',
  'PostgreSQL recovery log',
  'recoveryConsoleModal',
  'Append-only history',
  'review-selected-snapshot',
  'confirm-snapshot-restore',
  '/api/system/recovery/restore',
  "phrase='RESTORE SNAPSHOT '+snapshotId",
  'recoveryConfirmationChecked',
  "window.location.assign('/login?recovery=complete')",
  'Current staff/customer access controls are preserved',
  'every signed-in session is revoked'
]);
assertIncludes('Password-backed staff and owner guidance', app, [
  'Manager and mechanic username/password accounts.',
  'Manager and mechanic accounts use their own username and password',
  'Before enabling hardened Stripe launch mode',
  'Keep the PIN recovery path enabled until that password login is confirmed',
  '8+ characters with a letter and number'
]);
if (app.includes('Manager and mechanic PIN accounts.') || app.includes('Manager and mechanic accounts use their own PIN')) {
  fail('Manager and mechanic access must not be described as PIN-based.');
}
assertIncludes('Actionable Telnyx carrier rejection surface', app, [
  'Previous carrier rejection:',
  'historicalFailureReason',
  'Rejected use case:',
  'Resubmission locked:',
  'usecaseQualificationReason',
  'campaign_qualification',
  'carrierRegistrationStatus||status.carrierRegistrationNextAction'
]);
assertIncludes('Core readiness is distinct from controlled Stripe launch readiness', app, [
  'clarifyCoreReadinessLanguage',
  'Core operational check for environment keys',
  '<span>Core system</span><strong>Core ready</strong>',
  '<span>Core system</span><strong>Core blocked</strong>',
  '<span>Core system</span><b>Core ready</b>',
  '<span>Core system</span><b>Core blocked</b>',
  'This does not clear a Stripe launch; run Live launch preflight before any cutover.',
  '<strong>Core check only</strong>',
  'This check does not authorize a Stripe cutover.',
  'clear every live evidence gate while Clover remains active.'
]);

const staticActions = unique(app.matchAll(/data-action="([^"]+)"/g), match => {
  const value = match[1];
  if (value.includes("'+") || value.includes('"+') || value.includes('+esc') || value.includes('${')) return '';
  return value;
});

const fakeUiPatterns = [
  ['placeholder hash links', /href=["']#["']/],
  ['javascript void links', /javascript:void/i],
  ['not implemented controls', /not implemented/i]
];
[app, server, cardSetup].forEach((source, index) => {
  const label = ['app.js', 'server.js', 'card-setup.js'][index];
  fakeUiPatterns.forEach(([name, pattern]) => {
    if (pattern.test(source)) fail(label + ' contains fake UI ' + name + '. Visible controls must work, save a draft, or clearly route to provider setup.');
  });
});

const handledActions = new Set([
  ...unique(app.matchAll(/(?:^|[^\w.])a\s*===\s*['"]([^'"]+)['"]/g), match => match[1]),
  ...unique(app.matchAll(/b\.dataset\.action\s*===\s*['"]([^'"]+)['"]/g), match => match[1]),
  ...unique(app.matchAll(/closest\(['"]button\[data-action=\\?["']([^"'\\]+)\\?["']\]/g), match => match[1])
]);
for (const block of app.matchAll(/\[((?:\s*['"][^'"]+['"]\s*,?)+)\]\.indexOf\((?:a|b\.dataset\.action|actionName)\)/g)) {
  for (const action of block[1].matchAll(/['"]([^'"]+)['"]/g)) handledActions.add(action[1]);
}

const unhandled = staticActions.filter(action => !handledActions.has(action));
if (unhandled.length) {
  fail('Unhandled data-action button(s): ' + unhandled.join(', '));
}

assertIncludes('Open modal active definition', functionSlice('openModal'), ['aria-hidden', "style.display='grid'", "querySelector('.modal')", 'modal.scrollTop=0', "typeof requestAnimationFrame==='function'"]);
assertIncludes('Close modal active definition', functionSlice('closeModal'), ['aria-hidden', "textContent=''", "innerHTML=''"]);
assertIncludes('Auto refresh modal guard', app, ["if(modal&&modal.style.display==='grid')return"]);
assertIncludes('Post-save refresh wrapper', app, ['var __wheelsonBaseSave=save', 'reconcileFleetCustomerLinks()', 'if(ok)await refreshData(true)']);
assertIncludes('Provider-specific API handoff guidance', app, ['apiProviderGuidancePanel', 'Proof before connected', '10DLC approval', 'OpenAI API key and usable API credit', 'signed payment event', 'apiProviderStatusControl(p)', 'Calculated from live credentials']);

const criticalActionRequirements = [
  ['Vehicle save flow', 'save-vehicle', ['clearVehicleFromCustomerRecords', 'syncVehicleCustomerAssignment', 'await save()', 'closeModal()', "view='Operations'"]],
  ['Customer file save flow', 'save-contract-file', ['resolveCustomerFileVehicle', 'transferVehicleToCustomer', 'updateRecurringState', 'await save()', 'closeModal()', "tab=removed?'History':'Active'"]],
  ['Message send flow', 'send-message-now', ['/api/messages/send', 'channel:val', 'await refreshData(true)', 'closeModal()', "view='Messages'"]],
  ['Thread reply send flow', 'send-thread-message', ['/api/messages/send', 'threadMessageBody', 'messageThreadKey', "tab='Inbox'", "view='Messages'"]],
  ['Customer portal login save flow', 'save-customer-login', ['/api/customer-accounts', 'customerLoginName', 'await refreshData(true)', 'closeModal()', 'Settings()']],
  ['Customer portal draft creation flow', 'create-missing-customer-logins', ['/api/customer-accounts/create-missing-drafts', 'await refreshData(true)', 'portal draft']],
  ['Company account save flow', 'save-org', ['/api/organizations', 'await refreshData(true)', 'closeModal()', 'Organizations()']],
  ['Company subscription save flow', 'save-company-subscription', ['/api/billing/subscriptions', 'organizationId:button.dataset.id', 'await refreshData(true)', 'closeModal()', 'Organizations()']],
  ['Company invoice save flow', 'save-company-invoice', ['/api/billing/invoices/record', 'providerInvoiceId:val', 'await refreshData(true)', 'closeModal()', 'Organizations()']],
  ['Staff account save flow', 'save-staff', ['/api/staff-accounts', 'await refreshData(true)', 'closeModal()', 'Settings()']],
  ['API provider save flow', 'save-api-provider', ['/api/api-providers', 'await refreshData(true)', 'closeModal()', 'ApiRoadmap()']],
  ['API task creation flow', 'create-api-task', ['/api/tasks', 'await refreshData(true)', 'closeModal()', 'Dispatch()']],
  ['iFleet coverage task sync flow', 'sync-ifleet-coverage-tasks', ['/api/system/ifleet-coverage/tasks', 'await refreshData(true)', 'Dispatch()']],
  ['Launch proof task creation flow', 'create-launch-proof-task', ['/api/tasks', 'ifleetLaunchProofItems()', 'await refreshData(true)', 'Dispatch()']],
  ['Bulk launch proof task creation flow', 'create-all-launch-proof-tasks', ['/api/tasks', 'launchProofTaskExists', 'launchProofTaskPayload', 'await refreshData(true)', 'Dispatch()']],
  ['Star audit task creation flow', 'create-star-audit-task', ['/api/tasks', 'starSystemAuditItems()', 'starAuditTaskPayload', 'await refreshData(true)', 'Dispatch()']],
  ['Bulk Star audit task creation flow', 'create-all-star-audit-tasks', ['/api/tasks', 'starAuditTaskExists', 'starAuditTaskPayload', 'await refreshData(true)', 'Dispatch()']],
  ['Company staff prefill flow', 'new-staff', ['staffOrgPrefill', 'orgOptions(staffOrgPrefill)', 'staffOrg']],
  ['Email notification test flow', 'send-email-notification-test', ['/api/notifications/email/test', 'notificationEmailTo', 'notification-event:checked', "tab='Setup'", 'Messages()']],
  ['Dispute match accept flow', 'apply-claim-match', ['applyClaimCandidate', 'Dispute match accepted', 'await save()', 'render()']],
  ['Transaction match accept flow', 'apply-transaction-match', ['applyTransactionCandidate', 'Transaction match accepted', 'await save()', "tab='Transactions'", 'render()']],
  ['Clover reconciliation customer match flow', 'integrated-match-payment', ['/api/integrations/clover/payments/match', 'paymentId:button.dataset.id', "delete integrationUiCache.clover", 'await refreshData(true)', 'closeModal()']],
  ['Saved-card charge flow', 'charge-saved-card', ['/api/integrations/clover/manual-charge', 'Payment paid', 'Payment not found', 'await refreshData(true)']],
  ['Maintenance completion flow', 'confirm-complete-maintenance', ['isMonthlyMaintenance', 'addMonthsKey', 'inspectionChecklist', 'lastInspectionChecklist', 'await save()', 'closeModal()', 'Maintenance()']],
  ['Provider-neutral refund preparation flow', 'integrated-prepare-refund', ['/api/integrations/payments/refunds/prepare', 'amount:Number', 'await refreshData(true)', 'integratedOpenRefundRecord']],
  ['Provider-neutral refund execution flow', 'integrated-execute-refund', ['/api/integrations/payments/refunds/execute', 'confirmed:true', 'await refreshData(true)', 'closeModal()']],
  ['Manual provider refund completion flow', 'integrated-complete-refund', ['/api/integrations/payments/refunds/complete-manual', 'providerRefundId', 'confirmed:true', 'await refreshData(true)']],
  ['Provider-neutral dispute review flow', 'integrated-save-dispute', ['/api/integrations/payments/disputes/action', 'claimId', 'providerSubmissionReference:val', 'confirmed:confirmed', "disputeAction==='submitted'", 'await refreshData(true)']],
  ['Verification case creation flow', 'integrated-create-verification', ['/api/verification/cases', 'reference:val', 'expiresAt:val', 'await refreshData(true)']],
  ['Verification review flow', 'integrated-review-verification', ['/api/verification/cases/review', 'caseId', 'decision:', 'await refreshData(true)']],
  ['Accounting ledger rebuild flow', 'integrated-rebuild-accounting', ['/api/accounting/ledger/rebuild', 'await refreshData(true)', '/api/accounting/ledger']],
  ['Pickup calendar preparation flow', 'integrated-prepare-pickup', ['/api/pickups/', '/calendar', 'await refreshData(true)', '/api/pickups/calendar']],
  ['Physical pickup completion flow', 'integrated-save-pickup-completion', ['/api/pickups/', '/complete', 'integratedPickupMileage', 'integratedPickupConfirmed', 'await refreshData(true)']]
];
criticalActionRequirements.forEach(([label, action, required]) => assertIncludes(label, actionSlice(action), required));
assertIncludes('Clover refund eligibility guard', app, ['function cloverPaymentRefundable(row)', 'provider&&paid&&remaining>0', 'isOwner()&&!needsMatch&&cloverPaymentRefundable(row)']);
assertIncludes('Server-authoritative unmatched Clover queue', app, ['function cloverQueuePaymentKey(row)', 'forceMatch===true', "customer='Customer match needed'", 'if(!cache&&unmatchedKeys[key])return', 'serverUnmatched.map(function(row){return integratedRefundPaymentRow(row,true)}', 'integratedRefundPaymentRow(row,false)']);
assertIncludes('Clover reconciliation Operations repaint target', app, ["integrationScheduleCache('clover','/api/integrations/clover/reconciliation','Operations')", "integrationLoadCache('clover','/api/integrations/clover/reconciliation','Operations')"]);
assertIncludes('Clover reconciliation review count', app, ["localReview=refundableRows.filter", 'reviewCount=serverUnmatched.length+localReview+queueGap', "serverUnmatched.length+' Clover / '+localReview+' local review'"]);
assertIncludes('Missing Clover detail queue fallback', app, ['function integratedCloverQueueGapRow(count)', 'Clover record needs resync', 'Payment detail missing', 'integrated-refresh-clover', 'unmatched-serverUnmatched.length']);
assertIncludes('Customer portal readiness UI', app, ['customerPortalLoginReady', 'customerPortalGapPanel', 'Active customers below do not have login-ready portal access yet', 'Finish portal', 'loginReady']);
assertIncludes('Dispute candidate evidence copy helper', functionSlice('applyClaimCandidate'), ['candidate.vin', 'candidate.plate', 'candidate.tracker', 'candidate.phone', 'candidate.email', 'candidate.cloverCustomerId']);
assertIncludes('Stripe dispute provider-truth UI', functionSlice('integratedOpenDispute'), ['Submit evidence to Stripe', 'signed Stripe webhooks', 'cannot be entered manually', 'encrypted evidence packet']);
['repairAshleyDodgeTransfer', 'Ashley restored', 'Dodge Journey WHITE', 'Felicia V Gadson'].forEach(text => {
  if (app.includes(text)) fail('Customer-specific frontend repair code must not ship: ' + text);
});

const functionNames = new Set(unique(app.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g), match => match[1]));
const renderSlice = functionSlice('render');
if (!renderSlice) fail('Could not find render function.');
const renderMapMatch = renderSlice.match(/\(\{([^}]+)\}\[view\]\|\|Dashboard\)\(\)/);
const renderViews = new Map();
if (!renderMapMatch) fail('Could not find render view map.');
for (const match of renderMapMatch[1].matchAll(/'([^']+)'\s*:\s*([A-Za-z_$][\w$]*)/g)) {
  renderViews.set(match[1], match[2]);
}
renderViews.set('Apply', 'Apply');

const missingViewFunctions = [...renderViews.entries()].filter(([, fn]) => !functionNames.has(fn));
if (missingViewFunctions.length) {
  fail('Render view(s) point to missing function(s): ' + missingViewFunctions.map(([view, fn]) => `${view}->${fn}`).join(', '));
}

const staticViews = unique(app.matchAll(/data-view="([^"]+)"/g), match => {
  const value = match[1];
  if (value.includes("'+") || value.includes('"+') || value.includes('+esc') || value.includes('${')) return '';
  return value;
});
const missingStaticViews = staticViews.filter(view => !renderViews.has(view));
if (missingStaticViews.length) {
  fail('Static data-view target(s) do not render: ' + missingStaticViews.join(', '));
}

const navSlice = functionSlice('navForRole');
if (!navSlice) fail('Could not find navForRole function.');
const navArrayViews = unique(navSlice.matchAll(/'([^']+)'/g), match => {
  const value = match[1];
  if (['Owner', 'Manager', 'Mechanic'].includes(value)) return '';
  return /^[A-Z]/.test(value) ? value : '';
});
const missingNavViews = navArrayViews.filter(view => !renderViews.has(view));
if (missingNavViews.length) {
  fail('Navigation view(s) do not render: ' + missingNavViews.join(', '));
}

const topLevelNames = topLevelFunctionNames();
const duplicateTopLevelNames = [...new Set(topLevelNames.filter((name, index) => topLevelNames.indexOf(name) !== index))].sort();
if (duplicateTopLevelNames.length) {
  fail('Duplicate top-level function definition(s): ' + duplicateTopLevelNames.join(', '));
}

console.log('Static UI check passed: ' + staticActions.length + ' button actions, ' + staticViews.length + ' static view links, ' + renderViews.size + ' render views, and fresh asset version ' + indexCssVersions[0] + ' are wired.');
