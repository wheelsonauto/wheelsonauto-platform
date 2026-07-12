const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function finalFunctionSlice(name) {
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

function renderViews() {
  const render = finalFunctionSlice('render');
  const match = render.match(/\(\{([^}]+)\}\[view\]\|\|Dashboard\)\(\)/);
  if (!match) fail('Could not find render view map.');
  const views = new Map();
  for (const item of match[1].matchAll(/'([^']+)'\s*:\s*([A-Za-z_$][\w$]*)/g)) {
    views.set(item[1], item[2]);
  }
  views.set('Apply', 'Apply');
  return views;
}

function clean(value) {
  return String(value || '').trim();
}

function isStatic(value) {
  return value && !value.includes("'+") && !value.includes('"+') && !value.includes('${') && !value.includes('+esc');
}

function buttonFragments(source) {
  return [...source.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
}

function attr(fragment, name) {
  const match = fragment.match(new RegExp(name + '="([^"]+)"'));
  return match ? clean(match[1]) : '';
}

function literalButtonTargets(source) {
  return buttonFragments(source).map(fragment => ({
    fragment,
    view: attr(fragment, 'data-view'),
    tab: attr(fragment, 'data-tab'),
    dashboardTab: attr(fragment, 'data-dashboard-tab')
  })).filter(item =>
    (!item.view || isStatic(item.view)) &&
    (!item.tab || isStatic(item.tab)) &&
    (!item.dashboardTab || isStatic(item.dashboardTab))
  );
}

function guardTabs(source) {
  const match = source.match(/\[([^\]]+)\]\.indexOf\(selected\)<0/);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
}

function assertSetIncludes(label, values, required) {
  const set = new Set(values);
  const missing = required.filter(item => !set.has(item));
  if (missing.length) fail(label + ' is missing: ' + missing.join(', '));
}

function assertValidTab(label, view, tab, allowedTabs) {
  if (!tab || !allowedTabs.length) return;
  if (!allowedTabs.includes(tab)) {
    fail(label + ' points to unsupported tab "' + tab + '" on ' + view + '. Allowed: ' + allowedTabs.join(', '));
  }
}

const clickRouterStart = app.indexOf("document.addEventListener('click',function(e){var b=e.target.closest('button');");
if (clickRouterStart < 0) fail('General click router was not found.');
const clickRouter = app.slice(clickRouterStart, clickRouterStart + 2400);
[
  'b.dataset.localSearchRun',
  'b.dataset.dashboardTab',
  'b.dataset.view',
  "nav.indexOf(b.dataset.view)<0",
  "tab=b.dataset.tab||(view==='Payments'?'Active':'Board')",
  'else if(!isPublic&&b.dataset.tab)',
  'queueRender()',
  'actionAllowed(b.dataset.action)'
].forEach(text => {
  if (!clickRouter.includes(text)) fail('General click router is missing: ' + text);
});

const views = renderViews();
const allowedTabsByView = {
  Dashboard: [],
  Today: ['Due Today', 'Paid', 'Failed', 'Follow Up'],
  Applications: ['Pipeline', 'Active', 'Approved', 'Contract', 'Denied', 'Removed'],
  Payments: ['Active', 'Today', 'History', 'Transactions'],
  Operations: ['Fleet', 'Assigned', 'Service', 'Claims'],
  Fleet: ['Available', 'Prep', 'Assigned'],
  Maintenance: ['Open', 'Overdue', 'Monthly', 'Completed'],
  'Claims & Issues': ['Open', 'History', 'All'],
  Messages: ['Inbox', 'Star', 'Queue', 'Templates', 'History', 'Setup'],
  'Manager Portal': ['Overview', 'Fleet', 'Applications', 'Service', 'Issues'],
  'Mechanic Portal': ['Work', 'Overdue', 'All open', 'History']
};

Object.keys(allowedTabsByView).forEach(view => {
  if (!views.has(view)) fail('Known tabbed view is missing from render map: ' + view);
});

for (const [view, allowed] of Object.entries(allowedTabsByView)) {
  const fn = views.get(view);
  const source = finalFunctionSlice(fn);
  if (!source) fail('Missing function source for ' + view + ' -> ' + fn);

  if (allowed.length) {
    const guards = guardTabs(source);
    assertSetIncludes(view + ' selected-tab guard', guards, allowed);
  }

  const localTabs = literalButtonTargets(source)
    .filter(item => item.tab && !item.view)
    .map(item => item.tab);
  localTabs.forEach(tab => assertValidTab(view + ' local button', view, tab, allowed));
}

const dashboard = finalFunctionSlice('Dashboard');
const dashboardTabs = literalButtonTargets(dashboard).map(item => item.dashboardTab).filter(Boolean);
assertSetIncludes('Dashboard mobile sub-tabs', dashboardTabs, ['Dues', 'Service', 'Transactions', 'Applications']);

const helperSources = [
  finalFunctionSlice('Dashboard'),
  finalFunctionSlice('Payments'),
  finalFunctionSlice('Operations'),
  finalFunctionSlice('Reports'),
  finalFunctionSlice('dailyCloseout'),
  finalFunctionSlice('executiveReportBoard'),
  finalFunctionSlice('workflowMap'),
  finalFunctionSlice('queueList'),
  finalFunctionSlice('ManagerPortal'),
  finalFunctionSlice('MechanicPortal'),
  finalFunctionSlice('Messages')
].join('\n');

literalButtonTargets(helperSources)
  .filter(item => item.view)
  .forEach(item => {
    if (!views.has(item.view)) fail('Button points to missing view: ' + item.view);
    assertValidTab('Button target for ' + item.view, item.view, item.tab, allowedTabsByView[item.view] || []);
  });

const messages = finalFunctionSlice('Messages');
assertSetIncludes('Messages literal tabs', literalButtonTargets(messages).filter(item => item.tab && !item.view).map(item => item.tab), ['Inbox', 'Star', 'Queue', 'Templates', 'History', 'Setup']);

const payments = finalFunctionSlice('Payments');
assertSetIncludes('Payments literal tabs', literalButtonTargets(payments).filter(item => item.tab && !item.view).map(item => item.tab), ['Active', 'Today', 'History', 'Transactions']);
if (app.includes("data-tab=\"Attention\"") || app.includes("data-tab='Attention'") || app.includes(",'Attention'") || app.includes(',"Attention"')) {
  fail('Stale Payments Attention tab target found. Use Payments/Today for retry, not-found, setup, and failed-twice work.');
}

const operations = finalFunctionSlice('Operations');
assertSetIncludes('Operations literal tabs', literalButtonTargets(operations).filter(item => item.tab && !item.view).map(item => item.tab), ['Fleet', 'Assigned', 'Service', 'Claims']);

console.log('Navigation state check passed: view buttons, local tabs, dashboard tabs, and cross-view tab targets are valid.');
