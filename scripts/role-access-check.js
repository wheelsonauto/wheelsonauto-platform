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
    const next = source.indexOf('function ' + name + '(', cursor);
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const open = source.indexOf('{', start);
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
const textCustomerButton = finalFunctionSlice(app, 'textCustomerButton');
const apiAllowedForUser = finalFunctionSlice(server, 'apiAllowedForUser');
const stateForUserRead = finalFunctionSlice(server, 'stateForUserRead');
const stateForUserWrite = finalFunctionSlice(server, 'stateForUserWrite');

if (!navForRole || !navSections || !mobileQuickbar || !actionAllowed || !apiAllowedForUser) {
  fail('Could not find every role/access function.');
}

const mechanicNav = roleReturnArray(navForRole, 'mechanic');
const managerNav = roleReturnArray(navForRole, 'manager');
const ownerNav = roleReturnArray(navForRole, 'owner');
assertIncludes('Mechanic nav', mechanicNav, ['Mechanic Portal', 'Maintenance', 'Fleet', 'Claims & Issues']);
assertExcludes('Mechanic nav', mechanicNav, ['Messages', 'Payments', 'Reports', 'Settings', 'Website', 'Companies', 'API Roadmap']);
assertIncludes('Manager nav', managerNav, ['Manager Portal', 'Customers', 'Operations', 'Messages', 'Reports']);
assertExcludes('Manager nav', managerNav, ['Settings', 'Website', 'Companies', 'API Roadmap', 'Payments']);
assertIncludes('Owner nav', ownerNav, ['Dashboard', 'Payments', 'Operations', 'Messages', 'Reports', 'Website', 'Settings', 'Companies', 'API Roadmap']);

const mechanicSidebar = roleTernarySection(navSections, 'mechanic', 'manager');
const managerSidebar = roleTernarySection(navSections, 'manager');
const mechanicQuickbar = roleTernarySection(mobileQuickbar, 'mechanic', 'manager');
const managerQuickbar = roleTernarySection(mobileQuickbar, 'manager');
assertExcludes('Mechanic sidebar', mechanicSidebar, ['Messages', 'Payments', 'Reports', 'Settings']);
assertIncludes('Manager sidebar', managerSidebar, ['Messages', 'Reports']);
assertExcludes('Mechanic mobile quickbar', mechanicQuickbar, ['Messages', 'Payments', 'Settings']);
assertIncludes('Manager mobile quickbar', managerQuickbar, ['Messages', 'Reports']);

assertIncludes('Owner-only blocked actions', strings(actionAllowed), [
  'sync-all',
  'save-clover',
  'new-staff',
  'toggle-messaging',
  'toggle-star-ai',
  'toggle-star-autosend',
  'toggle-email-messaging'
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
  'star-ai-reply',
  'approve-star-ai'
]);
if (!/roleName\(\)==='mechanic'&&mechanicMessageBlocked/.test(actionAllowed)) fail('Mechanic message block is not enforced in actionAllowed.');
if (!/\(roleName\(\)==='mechanic'\|\|roleName\(\)==='manager'\)&&moneyBlocked/.test(actionAllowed)) fail('Mechanic/manager money block is not enforced in actionAllowed.');
if (!/roleName\(\)==='mechanic'\)return''/.test(textCustomerButton)) fail('Mechanic text buttons are not suppressed.');

if (!/role === 'mechanic' && pathname\.startsWith\('\/api\/messages'\)/.test(apiAllowedForUser)) fail('Mechanic API message routes are not blocked.');
if (!/role === 'mechanic' \|\| role === 'manager'/.test(apiAllowedForUser)) fail('Mechanic/manager payment route block is missing.');
assertIncludes('Owner-only API prefixes', strings(apiAllowedForUser), ['/api/integrations', '/api/sync', '/api/import', '/api/woa-autopay', '/api/api-providers', '/api/staff-accounts']);

const mechanicReadMatch = stateForUserRead.match(/if \(role === 'mechanic'\) \{((?:.|\n)*?)return mechanic;/m);
if (!mechanicReadMatch) fail('Could not find mechanic read filter.');
assertIncludes('Mechanic read data', strings(mechanicReadMatch[1]), ['vehicles', 'maintenance', 'claims']);
assertExcludes('Mechanic read data', strings(mechanicReadMatch[1]), ['payments', 'recurringPayments', 'apiProviders']);
if (!/configured:\s*false/.test(mechanicReadMatch[1])) fail('Mechanic messaging read state should be disabled.');

const mechanicWriteMatch = stateForUserWrite.match(/role === 'mechanic'\s*\?\s*\[((?:.|\n)*?)\]/m);
const managerWriteMatch = stateForUserWrite.match(/role === 'manager'\s*\?\s*\[((?:.|\n)*?)\]/m);
if (!mechanicWriteMatch || !managerWriteMatch) fail('Could not find staff write filters.');
assertIncludes('Mechanic write data', strings(mechanicWriteMatch[1]), ['maintenance', 'vehicles']);
assertExcludes('Mechanic write data', strings(mechanicWriteMatch[1]), ['messages', 'payments', 'recurringPayments', 'integrations']);
assertIncludes('Manager write data', strings(managerWriteMatch[1]), ['vehicles', 'applications', 'customers', 'contracts', 'maintenance', 'claims', 'messages', 'tasks']);
assertExcludes('Manager write data', strings(managerWriteMatch[1]), ['payments', 'recurringPayments', 'integrations', 'apiProviders', 'staffAccounts']);

console.log('Role access check passed: owner, manager, and mechanic navigation, actions, and API/state filters are guarded.');
