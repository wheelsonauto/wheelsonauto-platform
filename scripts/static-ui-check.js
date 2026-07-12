const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function fail(message) {
  throw new Error(message);
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
    'b.dataset.action!=="' + action + '"'
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
assertIncludes('Server CSS cache-busting link', server, ['/styles.css?v=' + indexCssVersions[0]]);
assertIncludes('Static asset no-store headers', server, ['staticFile(res, pathname)', "'Cache-Control': 'no-store'"]);
assertIncludes('Public app shell no-store headers', server, ["appHtml({ publicMode: true })", "'Cache-Control': 'no-store'"]);
assertIncludes('Authenticated app shell no-store headers', server, ["appHtml({ publicMode: false, user })", "'Cache-Control': 'no-store'"]);
assertIncludes('Session cookie security flags', server, ['function cookieSecurityFlags', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure']);
assertIncludes('Staff session cookie helper usage', server, ["sessionSetCookie('woa_session'", "sessionSetCookie('woa_customer_session'"]);

const staticActions = unique(app.matchAll(/data-action="([^"]+)"/g), match => {
  const value = match[1];
  if (value.includes("'+") || value.includes('"+') || value.includes('+esc') || value.includes('${')) return '';
  return value;
});

const handledActions = new Set([
  ...unique(app.matchAll(/(?:^|[^\w.])a\s*===\s*['"]([^'"]+)['"]/g), match => match[1]),
  ...unique(app.matchAll(/b\.dataset\.action\s*===\s*['"]([^'"]+)['"]/g), match => match[1])
]);
for (const block of app.matchAll(/\[((?:\s*['"][^'"]+['"]\s*,?)+)\]\.indexOf\((?:a|b\.dataset\.action)\)/g)) {
  for (const action of block[1].matchAll(/['"]([^'"]+)['"]/g)) handledActions.add(action[1]);
}

const unhandled = staticActions.filter(action => !handledActions.has(action));
if (unhandled.length) {
  fail('Unhandled data-action button(s): ' + unhandled.join(', '));
}

assertIncludes('Open modal active definition', functionSlice('openModal'), ['aria-hidden', "style.display='grid'"]);
assertIncludes('Close modal active definition', functionSlice('closeModal'), ['aria-hidden', "textContent=''", "innerHTML=''"]);
assertIncludes('Auto refresh modal guard', app, ["if(modal&&modal.style.display==='grid')return"]);
assertIncludes('Post-save refresh wrapper', app, ['var __wheelsonBaseSave=save', 'reconcileFleetCustomerLinks()', 'if(ok)await refreshData(true)']);

const criticalActionRequirements = [
  ['Vehicle save flow', 'save-vehicle', ['clearVehicleFromCustomerRecords', 'syncVehicleCustomerAssignment', 'await save()', 'closeModal()', "view='Operations'"]],
  ['Customer file save flow', 'save-contract-file', ['resolveCustomerFileVehicle', 'transferVehicleToCustomer', 'updateRecurringState', 'await save()', 'closeModal()', "tab=removed?'History':'Active'"]],
  ['Message send flow', 'send-message-now', ['/api/messages/send', 'channel:val', 'await refreshData(true)', 'closeModal()', "view='Messages'"]],
  ['Thread reply send flow', 'send-thread-message', ['/api/messages/send', 'threadMessageBody', 'messageThreadKey', "tab='Inbox'", "view='Messages'"]],
  ['Customer portal login save flow', 'save-customer-login', ['/api/customer-accounts', 'customerLoginName', 'await refreshData(true)', 'closeModal()', 'Settings()']],
  ['Customer portal draft creation flow', 'create-missing-customer-logins', ['/api/customer-accounts/create-missing-drafts', 'await refreshData(true)', 'portal draft']],
  ['Company account save flow', 'save-org', ['/api/organizations', 'await refreshData(true)', 'closeModal()', 'Organizations()']],
  ['Staff account save flow', 'save-staff', ['/api/staff-accounts', 'await refreshData(true)', 'closeModal()', 'Settings()']],
  ['API provider save flow', 'save-api-provider', ['/api/api-providers', 'await refreshData(true)', 'closeModal()', 'ApiRoadmap()']],
  ['API task creation flow', 'create-api-task', ['/api/tasks', 'await refreshData(true)', 'closeModal()', 'Dispatch()']],
  ['Company staff prefill flow', 'new-staff', ['staffOrgPrefill', 'orgOptions(staffOrgPrefill)', 'staffOrg']],
  ['Email notification test flow', 'send-email-notification-test', ['/api/notifications/email/test', 'notificationEmailTo', 'notification-event:checked', "tab='Setup'", 'Messages()']],
  ['Dispute match accept flow', 'apply-claim-match', ['applyClaimCandidate', 'Dispute match accepted', 'await save()', 'ClaimsIssues()']],
  ['Transaction match accept flow', 'apply-transaction-match', ['applyTransactionCandidate', 'Transaction match accepted', 'await save()', "tab='Transactions'", 'render()']],
  ['Saved-card charge flow', 'charge-saved-card', ['/api/integrations/clover/manual-charge', 'Payment paid', 'Payment not found', 'await refreshData(true)']],
  ['Maintenance completion flow', 'confirm-complete-maintenance', ['isMonthlyMaintenance', 'addMonthsKey', 'inspectionChecklist', 'lastInspectionChecklist', 'await save()', 'closeModal()', 'Maintenance()']]
];
criticalActionRequirements.forEach(([label, action, required]) => assertIncludes(label, actionSlice(action), required));
assertIncludes('Customer portal readiness UI', app, ['customerPortalLoginReady', 'customerPortalGapPanel', 'Active customers below do not have login-ready portal access yet', 'Finish portal', 'loginReady']);
assertIncludes('Dispute candidate evidence copy helper', functionSlice('applyClaimCandidate'), ['candidate.vin', 'candidate.plate', 'candidate.tracker', 'candidate.phone', 'candidate.email', 'candidate.cloverCustomerId']);

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
