const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function fail(message) {
  throw new Error(message);
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

function strings(source) {
  return [...source.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]);
}

function roleReturnArray(functionSource, role) {
  const pattern = role === 'owner'
    ? /return\s*\[((?:.|\n)*?)\]\s*}/m
    : new RegExp("if\\(r===['\"]" + role + "['\"]\\)return\\[((?:.|\\n)*?)\\]", 'm');
  const match = functionSource.match(pattern);
  return match ? strings(match[1]) : [];
}

function roleTernarySection(functionSource, role, nextRole) {
  const pattern = new RegExp("role===['\"]" + role + "['\"]\\?\\[((?:.|\\n)*?)\\]" + (nextRole ? ":role===['\"]" + nextRole + "['\"]" : ':'), 'm');
  const match = functionSource.match(pattern);
  return match ? strings(match[1]) : [];
}

function assertIncludes(name, values, required) {
  const missing = required.filter(item => !values.includes(item));
  if (missing.length) fail(name + ' is missing: ' + missing.join(', '));
}

function assertExcludes(name, values, banned) {
  const present = banned.filter(item => values.includes(item));
  if (present.length) fail(name + ' should not include: ' + present.join(', '));
}

const navForRole = finalFunctionSlice(app, 'navForRole');
const navSections = finalFunctionSlice(app, 'navSections');
const mobileQuickbar = finalFunctionSlice(app, 'mobileQuickbar');
const actionAllowed = finalFunctionSlice(app, 'actionAllowed');
const settingsFocused = finalFunctionSlice(app, 'SettingsFocused');
const settingsAccountPanel = finalFunctionSlice(app, 'settingsAccountPanel');
const textCustomerButton = finalFunctionSlice(app, 'textCustomerButton');
const accessCommandPanel = finalFunctionSlice(app, 'accessCommandPanel');
const managerCommandItems = finalFunctionSlice(app, 'managerCommandItems');
const managerCommandBoard = finalFunctionSlice(app, 'managerCommandBoard');
const mechanicCommandItems = finalFunctionSlice(app, 'mechanicCommandItems');
const mechanicCommandBoard = finalFunctionSlice(app, 'mechanicCommandBoard');
const apiAllowedForUser = finalFunctionSlice(server, 'apiAllowedForUser');
const activeStaffSessionUser = finalFunctionSlice(server, 'activeStaffSessionUser');
const crossOriginSessionWrite = finalFunctionSlice(server, 'crossOriginSessionWrite');
const stateForUserRead = finalFunctionSlice(server, 'stateForUserRead');
const stateForUserWrite = finalFunctionSlice(server, 'stateForUserWrite');
const protectConcurrentLocalWrites = finalFunctionSlice(server, 'protectConcurrentLocalWrites');
const mergeConcurrentState = finalFunctionSlice(server, 'mergeConcurrentState');
const dataScopedToOrganization = finalFunctionSlice(server, 'dataScopedToOrganization');

if (!navForRole || !navSections || !mobileQuickbar || !actionAllowed || !apiAllowedForUser || !managerCommandItems || !managerCommandBoard || !mechanicCommandItems || !mechanicCommandBoard) {
  fail('Could not find every role/access function.');
}
if (!protectConcurrentLocalWrites) fail('Could not find concurrent-write protection helper.');
if (!mergeConcurrentState) fail('Could not find concurrent state merge helper.');
if (!dataScopedToOrganization) fail('Could not find organization scoping helper.');
if (!activeStaffSessionUser || !crossOriginSessionWrite) fail('Could not find staff session revocation or cross-origin write protection.');

const mechanicNav = roleReturnArray(navForRole, 'mechanic');
const managerNav = roleReturnArray(navForRole, 'manager');
const ownerNav = roleReturnArray(navForRole, 'owner');
assertIncludes('Mechanic nav', mechanicNav, ['Mechanic Portal', 'Maintenance', 'Fleet', 'Claims & Issues', 'Settings']);
assertExcludes('Mechanic nav', mechanicNav, ['Messages', 'Payments', 'Reports', 'Website', 'Companies', 'API Roadmap']);
assertIncludes('Manager nav', managerNav, ['Manager Portal', 'Customers', 'Operations', 'Messages', 'Reports', 'Settings']);
assertExcludes('Manager nav', managerNav, ['Website', 'Companies', 'API Roadmap', 'Payments']);
assertIncludes('Owner nav', ownerNav, ['Dashboard', 'Payments', 'Operations', 'Messages', 'Reports', 'Website', 'Settings', 'Companies', 'API Roadmap']);

const mechanicSidebar = roleTernarySection(navSections, 'mechanic', 'manager');
const managerSidebar = roleTernarySection(navSections, 'manager');
const mechanicQuickbar = roleTernarySection(mobileQuickbar, 'mechanic', 'manager');
const managerQuickbar = roleTernarySection(mobileQuickbar, 'manager');
assertIncludes('Mechanic sidebar', mechanicSidebar, ['Settings']);
assertExcludes('Mechanic sidebar', mechanicSidebar, ['Messages', 'Payments', 'Reports']);
assertIncludes('Manager sidebar', managerSidebar, ['Messages', 'Reports', 'Settings']);
assertIncludes('Mechanic mobile quickbar', mechanicQuickbar, ['Settings']);
assertExcludes('Mechanic mobile quickbar', mechanicQuickbar, ['Messages', 'Payments']);
assertIncludes('Manager mobile quickbar', managerQuickbar, ['Messages', 'Reports', 'Settings']);

if (!settingsFocused || !settingsAccountPanel) fail('Could not find focused role-safe Account settings.');
if (!/allowed=isOwner\(\)\?\['Connections','Staff','CustomerLogins','Security','Website'\]:\['Account'\]/.test(settingsFocused)) {
  fail('Non-owner Settings must be restricted to the Account tab.');
}
['Owner login & security', 'Set username & password', 'Disable PIN login', 'Account access', 'Reset password', '/logout'].forEach(text => {
  if (!settingsAccountPanel.includes(text)) fail('Account settings panel is missing: ' + text);
});
if (!settingsFocused.includes("if(selected==='Security')body+=settingsAccountPanel()+roleAccessMatrix()+auditTrailPanel()")) {
  fail('Owner login controls must live in Security without a duplicate owner Account tab.');
}
['Clover connection', 'Staff accounts', 'Website connection', 'Customer portal logins'].forEach(text => {
  if (settingsAccountPanel.includes(text)) fail('Account settings panel should not include: ' + text);
});

assertIncludes('Owner-only blocked actions', strings(actionAllowed), [
  'sync-all',
  'save-clover',
  'new-staff',
  'new-customer-login',
  'save-customer-login',
  'toggle-messaging',
  'toggle-star-ai',
  'toggle-star-autosend',
  'toggle-email-messaging',
  'save-email-notification-settings',
  'send-email-notification-test'
]);
assertIncludes('Money blocked actions', strings(actionAllowed), [
  'charge-saved-card',
  'send-pay-link',
  'new-autopay',
  'save-autopay',
  'change-card-on-file',
  'remove-autopay',
  'create-card-setup'
]);
assertIncludes('Mechanic message blocked actions', strings(actionAllowed), [
  'compose-message',
  'send-message-now',
  'send-thread-message',
  'select-message-thread',
  'star-ai-reply',
  'star-ai-custom',
  'approve-star-ai'
]);
if (!/roleName\(\)==='mechanic'&&mechanicMessageBlocked/.test(actionAllowed)) fail('Mechanic message block is not enforced in actionAllowed.');
if (!/open-contract/.test(actionAllowed) || !/open-contract-for-name/.test(actionAllowed)) fail('Mechanic customer-file shortcuts are not blocked.');
if (!/\(roleName\(\)==='mechanic'\|\|roleName\(\)==='manager'\)&&moneyBlocked/.test(actionAllowed)) fail('Mechanic/manager money block is not enforced in actionAllowed.');
if (!/roleName\(\)==='mechanic'\)return''/.test(textCustomerButton)) fail('Mechanic text buttons are not suppressed.');
assertIncludes('Manager command board', managerCommandBoard, ['Manager command queue', 'No Clover keys or payment controls', 'manager-command-board']);
assertIncludes('Manager command items', managerCommandItems, ['Applications', 'Messages', 'Claims & Issues', 'Maintenance', 'Fleet']);
assertExcludes('Manager command items', strings(managerCommandItems), ['charge-saved-card', 'send-pay-link', 'new-autopay', 'save-autopay', 'change-card-on-file']);
assertIncludes('Mechanic command board', mechanicCommandBoard, ['Mechanic shop queue', 'No customer messaging or money tools', 'mechanic-command-board']);
assertIncludes('Mechanic command items', mechanicCommandItems, ['Mechanic Portal', 'Maintenance', 'Fleet', 'Claims & Issues']);
assertExcludes('Mechanic command items', strings(mechanicCommandItems), ['Messages', 'Reports', 'Payments', 'charge-saved-card', 'send-pay-link', 'compose-message', 'Text']);
if (!/STAFF_PIN_LOGIN_ENABLED/.test(server) || !/if \(!STAFF_PIN_LOGIN_ENABLED\) return null;/.test(server)) fail('Staff PIN login should be disabled unless explicitly enabled.');
if (!/authPolicy = require\('\.\/auth-policy'\)/.test(server) || !/WOA_OWNER_PIN_FALLBACK_ENABLED/.test(server)) {
  fail('Owner authentication policy must be loaded and explicitly configurable.');
}
const ownerLoginMatches = finalFunctionSlice(server, 'ownerLoginMatches');
const staffLoginPage = finalFunctionSlice(server, 'loginPage');
const productionInfrastructurePreflight = finalFunctionSlice(server, 'productionInfrastructurePreflight');
if (!/ownerPinLoginAllowed\(data\)/.test(ownerLoginMatches) || !/ownerPinLoginAllowed\(data\)/.test(staffLoginPage)) {
  fail('Owner PIN fallback must be policy-gated in both sign-in behavior and the login UI.');
}
if (!/ownerAuthentication\.passwordLoginConfigured/.test(productionInfrastructurePreflight) || !/ownerAuthentication\.passwordLoginStrong/.test(productionInfrastructurePreflight) || !/ownerAuthentication\.passwordLoginVerified/.test(productionInfrastructurePreflight) || !/ownerAuthentication\.pinFallbackAllowed/.test(productionInfrastructurePreflight)) {
  fail('The production Stripe launch gate must require a verified password-backed owner sign-in with owner PIN fallback disabled.');
}
if (!/\/api\/account\/owner-access\/disable-pin/.test(server) || !/Only the owner can disable owner recovery PIN access/.test(server)) fail('Owner PIN cutover must remain an explicit owner-only API action.');
if (!/cloverRecurringMigrationReadiness/.test(productionInfrastructurePreflight) || !/fresh Clover recurring roster for controlled cutover/.test(productionInfrastructurePreflight)) {
  fail('The production Stripe launch gate must require a fresh complete Clover recurring roster before cutover.');
}
if (!/providerProofCollectionMissing/.test(productionInfrastructurePreflight) || !/provider_proof_collection/.test(productionInfrastructurePreflight) || !/WOA_MIGRATION_MAINTENANCE_MODE=0/.test(productionInfrastructurePreflight)) {
  fail('The production launch preflight must distinguish safe provider-proof collection and reject maintenance mode as final launch readiness.');
}
if (!/staffLoginReady/.test(app) || !/Needs password/.test(accessCommandPanel)) fail('Staff access UI should focus on password-backed staff logins.');
if (!/Customer password help requested/.test(server) || !/Staff password help requested/.test(server)) {
  fail('Password help requests should be owner audit logged.');
}

if (!/role === 'mechanic' && pathname\.startsWith\('\/api\/messages'\)/.test(apiAllowedForUser)) fail('Mechanic API message routes are not blocked.');
if (!/role === 'mechanic' && pathname\.startsWith\('\/api\/reports'\)/.test(apiAllowedForUser)) fail('Mechanic API report routes are not blocked.');
if (!/role === 'mechanic' && pathname\.startsWith\('\/api\/system'\)/.test(apiAllowedForUser)) fail('Mechanic API system routes are not blocked.');
if (!/role === 'mechanic' \|\| role === 'manager'/.test(apiAllowedForUser)) fail('Mechanic/manager payment route block is missing.');
assertIncludes('Manager provider adapter exceptions', strings(apiAllowedForUser), ['/api/integrations/tracker', '/api/integrations/marketing', '/api/billing/summary']);
assertIncludes('Owner-only API prefixes', strings(apiAllowedForUser), ['/api/integrations', '/api/sync', '/api/import', '/api/woa-autopay', '/api/api-providers', '/api/staff-accounts', '/api/customer-accounts', '/api/organizations', '/api/billing', '/api/notifications']);
if (!strings(apiAllowedForUser).includes('/api/reset')) fail('Platform data reset must be owner-only at the API role boundary.');
if (!/\['manager', 'mechanic'\]\.includes\(role\)/.test(apiAllowedForUser)) fail('Unknown or legacy staff roles must default to no API access.');
if (!/filter\(staffStatusActive\)/.test(activeStaffSessionUser) || !/activeStaffSessionCache/.test(activeStaffSessionUser)) fail('Signed staff sessions must be revalidated against the current active account record.');
if (!/woa_session/.test(crossOriginSessionWrite) || !/woa_customer_session/.test(crossOriginSessionWrite)) fail('Cross-origin write protection must cover staff and customer session cookies.');
assertIncludes('Staff state scrub collections', strings(stateForUserRead), ['paymentRequests']);
if (!/delete safe\.subscriptions;/.test(stateForUserRead) || !/delete safe\.billingInvoices;/.test(stateForUserRead) || !/delete safe\.billingEvents;/.test(stateForUserRead)) {
  fail('Staff billing state must remove subscription, invoice, and provider-event ledgers.');
}
if (!/if \(!owner\) safe = dataScopedToOrganization\(safe, userOrganizationId\(user\)\);[\s\S]*enrichLinkedProfiles\(safe\);/.test(stateForUserRead)) {
  fail('Staff read state should scope to the user company before profile enrichment.');
}
if (!/key === 'organizations' \? String\(row && row\.id \|\| ''\) === orgId : rowOrganizationId\(row\) === orgId/.test(dataScopedToOrganization)) {
  fail('Organization scoping should filter company records by id while filtering data records by organizationId.');
}
if (!/preferIncoming/.test(protectConcurrentLocalWrites + mergeConcurrentState)
  || !/baseState/.test(protectConcurrentLocalWrites + mergeConcurrentState)
  || !/mergeConcurrentRows\(data\[key\], latest\[key\], baseState\[key\], key, preferIncoming\)/.test(mergeConcurrentState)) {
  fail('Concurrent direct-save three-way merge preference is not wired in protectConcurrentLocalWrites.');
}
if (!/organizationId:\s*userOrganizationId\(user\)/.test(server)) {
  fail('Staff write merges should stamp incoming rows to the signed-in company.');
}
if (!/changed:\s*changes\.length > 0/.test(server) || !/changes,\s*version:\s*await dataVersion\(\)/.test(server)) {
  fail('State save route should return changed status and change details.');
}
if (!/protectConcurrentLocalWrites\(nextState,\s*\{\s*preferIncoming:\s*true,\s*preserveLatestIntegrations:\s*true\s*\}\)/.test(server)) {
  fail('State saves should preserve concurrent background sync rows and the newest integration state.');
}
['/api/staff-accounts', '/api/customer-accounts', '/api/organizations', '/api/api-providers', '/api/tasks', '/api/account/password'].forEach(route => {
  const index = server.indexOf("url.pathname === '" + route + "'");
  if (index < 0) fail('Could not find direct-save route: ' + route);
  const slice = server.slice(index, index + 3200);
  if (!slice.includes('preferIncoming: true')) fail(route + ' must preserve the just-saved row during concurrent-write protection.');
});

const mechanicReadMatch = stateForUserRead.match(/if \(role === 'mechanic'\) \{((?:.|\n)*?)return mechanic;/m);
if (!mechanicReadMatch) fail('Could not find mechanic read filter.');
assertIncludes('Mechanic read data', strings(mechanicReadMatch[1]), ['vehicles', 'maintenance', 'claims']);
assertExcludes('Mechanic read data', strings(mechanicReadMatch[1]), ['payments', 'recurringPayments', 'apiProviders']);
if (!/configured:\s*false/.test(mechanicReadMatch[1])) fail('Mechanic messaging read state should be disabled.');
if (!/scrubMechanicMoneyFields/.test(stateForUserRead)) fail('Mechanic read state should scrub money fields.');
if (!/isMechanicVisibleClaim/.test(stateForUserRead + server)) fail('Mechanic read state should filter toll/dispute/payment claim records.');
assertIncludes('Staff read redaction', stateForUserRead, ['delete safe.auditLogs', 'scrubPrivateOperationalFields', 'enrichLinkedProfiles(safe)']);

const mechanicWriteMatch = stateForUserWrite.match(/role === 'mechanic'\s*\?\s*\[((?:.|\n)*?)\]/m);
const managerWriteMatch = stateForUserWrite.match(/role === 'manager'\s*\?\s*\[((?:.|\n)*?)\]/m);
if (!mechanicWriteMatch || !managerWriteMatch) fail('Could not find staff write filters.');
assertIncludes('Mechanic write data', strings(mechanicWriteMatch[1]), ['maintenance', 'vehicles']);
assertExcludes('Mechanic write data', strings(mechanicWriteMatch[1]), ['messages', 'payments', 'recurringPayments', 'integrations']);
if (!/sanitizeMechanicCollectionWrite/.test(stateForUserWrite)) fail('Mechanic write state should sanitize money and customer assignment fields.');
if (!/preservePrivateOperationalFields/.test(server)) fail('Staff saves should preserve hidden owner-only payment/source fields.');
assertIncludes('Manager write data', strings(managerWriteMatch[1]), ['vehicles', 'applications', 'customers', 'contracts', 'maintenance', 'claims', 'messages', 'tasks']);
assertExcludes('Manager write data', strings(managerWriteMatch[1]), ['payments', 'recurringPayments', 'integrations', 'apiProviders', 'staffAccounts', 'customerAccounts']);

console.log('Role access check passed: owner, manager, and mechanic navigation, actions, and API/state filters are guarded.');
