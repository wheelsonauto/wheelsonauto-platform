const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'seed.json'), 'utf8'));

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
    toString: () => [...values].join(' ')
  };
}

function camel(name) {
  return String(name || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseDataset(fragment) {
  const dataset = {};
  for (const match of fragment.matchAll(/\sdata-([a-z0-9-]+)="([^"]*)"/gi)) {
    dataset[camel(match[1])] = match[2];
  }
  return dataset;
}

function element(id, documentRef) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    classList: classList(),
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    appendChild() {},
    remove() {},
    click() {},
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    dispatchEvent() { return true; },
    get firstElementChild() { return null; },
    get parentElement() { return null; },
    get ownerDocument() { return documentRef; }
  };
}

function makeDocument() {
  let eventOrder = 0;
  const documentRef = {
    hidden: false,
    elements: {},
    eventHandlers: {},
    body: null,
    getElementById(id) {
      return this.elements[id] || null;
    },
    createElement(tag) {
      const node = element(tag, this);
      node.tagName = String(tag || '').toUpperCase();
      return node;
    },
    addEventListener(type, handler, options) {
      this.eventHandlers[type] = this.eventHandlers[type] || [];
      this.eventHandlers[type].push({
        handler,
        capture: options === true || !!(options && options.capture),
        order: eventOrder
      });
      eventOrder += 1;
    },
    querySelectorAll(selector) {
      if (selector !== 'button[data-view]' && selector !== 'button[data-action]') return [];
      return buttonElements(this, selector);
    },
    querySelector() {
      return null;
    }
  };
  ['root', 'modalBackdrop', 'modalTitle', 'modalBody', 'toast'].forEach(id => {
    documentRef.elements[id] = element(id, documentRef);
  });
  documentRef.body = element('body', documentRef);
  documentRef.body.contains = () => true;
  documentRef.body.appendChild = () => {};
  return documentRef;
}

function buttonElements(documentRef, selector) {
  const htmlTargets = [documentRef.elements.root, documentRef.elements.modalBody];
  const rows = [];
  for (const target of htmlTargets) {
    const html = String(target.innerHTML || '');
    for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)) {
      const fragment = match[0];
      const dataset = parseDataset(fragment);
      if (selector === 'button[data-view]' && !dataset.view) continue;
      if (selector === 'button[data-action]' && !dataset.action) continue;
      rows.push({
        dataset,
        remove() {
          target.innerHTML = String(target.innerHTML || '').replace(fragment, '');
        }
      });
    }
  }
  return rows;
}

function makeContext(user, publicMode = false) {
  const document = makeDocument();
  const storage = {};
  const window = {
    __PUBLIC_MODE__: publicMode,
    __CURRENT_USER__: user,
    __SERVER_DATA__: JSON.parse(JSON.stringify(seed)),
    addEventListener() {},
    removeEventListener() {},
    location: { href: '/', origin: 'https://wheelsonauto-platform.onrender.com' }
  };
  const context = {
    window,
    document,
    localStorage: {
      getItem: key => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: key => { delete storage[key]; }
    },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: fn => { if (typeof fn === 'function') fn(); },
    Event: function Event(type) { this.type = type; },
    MutationObserver: function MutationObserver() {
      this.observe = () => {};
      this.disconnect = () => {};
    },
    Blob: function Blob() {},
    URL: { createObjectURL: () => 'blob:smoke', revokeObjectURL: () => {} },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(JSON.stringify(seed))
    })
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return context;
}

function html(context) {
  return String(context.document.getElementById('root').innerHTML || '');
}

function modalHtml(context) {
  const title = String(context.document.getElementById('modalTitle').textContent || '');
  const body = String(context.document.getElementById('modalBody').innerHTML || '');
  return title + '\n' + body;
}

function fakeButton(context, dataset) {
  const documentRef = context.document;
  const button = element('button', documentRef);
  const searchInput = element('local-search-input', documentRef);
  searchInput.classList.add('local-search-input');
  searchInput.focused = false;
  searchInput.focus = () => {
    searchInput.focused = true;
  };
  searchInput.dispatchEvent = event => {
    const handlers = (documentRef.eventHandlers.input || []).slice().sort((a, b) => a.order - b.order);
    handlers.forEach(item => item.handler({ target: searchInput, type: event.type || 'input' }));
    return true;
  };
  const searchShell = {
    querySelector(selector) {
      return selector === '.local-search-input' ? searchInput : null;
    }
  };
  button.dataset = { ...dataset };
  button.textContent = dataset.text || 'Smoke button';
  button.localSearchInput = searchInput;
  button.closest = selector => {
    if (selector === 'button') return button;
    if (selector === 'button[data-action]') return button.dataset.action ? button : null;
    if (selector === '.local-search') return searchShell;
    return null;
  };
  return button;
}

async function dispatchClick(context, dataset) {
  const button = fakeButton(context, dataset);
  let stopped = false;
  const event = {
    target: { closest: selector => button.closest(selector) },
    preventDefault() {},
    stopImmediatePropagation() {
      stopped = true;
    }
  };
  const handlers = (context.document.eventHandlers.click || [])
    .slice()
    .sort((a, b) => (Number(b.capture) - Number(a.capture)) || (a.order - b.order));
  for (const item of handlers) {
    await item.handler(event);
    if (stopped) break;
  }
  return button;
}

function renderView(context, view, tab, dashboardTab) {
  context.view = view;
  if (tab !== undefined) context.tab = tab;
  if (dashboardTab !== undefined) context.dashboardTab = dashboardTab;
  context.render();
  return html(context);
}

function assertHealthy(label, output, required = []) {
  assert(output.length > 600, label + ' rendered too little HTML.');
  assert(!/\bundefined\b/.test(output), label + ' rendered "undefined".');
  assert(!/\bNaN\b/.test(output), label + ' rendered "NaN".');
  assert(!/\[object Object\]/.test(output), label + ' rendered an object string.');
  required.forEach(text => assert(output.includes(text), label + ' is missing: ' + text));
}

function assertNo(label, output, banned = []) {
  banned.forEach(text => assert(!output.includes(text), label + ' should not include: ' + text));
}

function countOf(output, text) {
  return String(output || '').split(text).length - 1;
}

function assertCountAtLeast(label, output, text, minimum) {
  const count = countOf(output, text);
  assert(count >= minimum, label + ' should include at least ' + minimum + ' "' + text + '" marker(s); found ' + count + '.');
}

function assertCompactBoard(label, output, markers = []) {
  assertHealthy(label, output, markers);
  assertCountAtLeast(label, output, 'card section', 1);
  assert(output.includes('local-search') || output.includes('dashboard-mobile-tabs') || output.includes('message-status-strip'), label + ' should include local search, dashboard tabs, or a compact status strip.');
  assert(!/style="[^"]*(?:background:\s*(?:#fff|white)|filter:\s*blur)/i.test(output), label + ' should not render inline white backgrounds or blur filters.');
}

function localSearchSmoke(context) {
  const rows = [
    { textContent: '2016 Ford Focus VIN 1FADP3K24GL123456', style: {}, closest: () => null },
    { textContent: '2024 Mitsubishi Mirage Tracker ACH-081', style: {}, closest: () => null }
  ];
  let emptyNode = null;
  const searchMarker = {
    insertAdjacentElement(_position, node) {
      emptyNode = node;
    }
  };
  const section = {
    getAttribute(name) {
      return name === 'data-limit' ? '0' : '';
    },
    querySelector(selector) {
      if (selector === '.local-search-empty') return emptyNode;
      if (selector === '.local-search') return searchMarker;
      return null;
    },
    querySelectorAll() {
      return rows;
    }
  };
  context.applyLocalSearch(section, 'focus');
  assert(rows[0].style.display === '', 'Local search should keep matching rows visible.');
  assert(rows[1].style.display === 'none', 'Local search should hide nonmatching rows.');
  assert(emptyNode && emptyNode.style.display === 'none', 'Local search empty message should stay hidden when matches exist.');
  context.applyLocalSearch(section, 'not-a-real-row');
  assert(rows.every(row => row.style.display === 'none'), 'Local search should hide every row when there are no matches.');
  assert(emptyNode.style.display === '', 'Local search empty message should show when no matches exist.');
}

async function actionModalSmoke(context) {
  const vehicle = context.db.vehicles.find(row => row.id);
  const maintenance = context.db.maintenance.find(row => row.id);
  const claim = context.db.claims.find(row => row.id);
  const contract = context.db.contracts.find(row => row.id);
  const recurring = context.recurringRoster().find(row => row.id && String(row.status || '').toLowerCase() === 'active')
    || context.recurringRoster().find(row => row.id);
  const setupRecurring = context.recurringRoster().find(row => context.isCardSetupRow(row));

  const checks = [
    ['reset-password', '', ['Reset password', 'New password']],
    ['new-autopay', '', ['Add recurring customer', 'Search ready fleet vehicle', 'First run date', 'Charge time']],
    ['new-vehicle', '', ['Add vehicle', 'VIN', 'Old temp tag']],
    ['new-maintenance', '', ['Add maintenance job', 'Vehicle', 'Due date']],
    ['new-claim', '', ['Add claim or issue', 'Customer', 'Next follow-up']],
    ['new-staff', '', ['Add staff account', 'Username', 'Password']],
    ['new-customer-login', '', ['Add customer portal login', 'Customer name', 'Portal link']],
    ['new-message-template', '', ['Add message template', 'Message body']]
  ];

  if (vehicle) checks.push(['open-vehicle', vehicle.id, ['Edit vehicle:', 'VIN', 'Tracker', 'Return to fleet']]);
  if (maintenance) {
    checks.push(['open-maintenance', maintenance.id, ['Edit maintenance:', 'Due date', 'Save job']]);
    checks.push(['complete-maintenance', maintenance.id, ['Complete maintenance:', 'Completed date', 'Mark done']]);
  }
  if (claim) {
    checks.push(['open-claim', claim.id, ['Issue:', 'Provider / agency', 'Save issue']]);
    checks.push(['mark-claim-paid', claim.id, ['Mark claim paid:', 'Amount paid', 'Save paid']]);
  }
  if (contract) {
    checks.push(['open-contract', contract.id, ['Customer file:', 'Search / switch vehicle', 'Save file']]);
  }
  if (recurring) {
    checks.push(['open-autopay', recurring.id, ['Recurring customer:', 'Edit autopay', 'Card on file']]);
    checks.push(['change-autopay-date', recurring.id, ['Edit autopay:', 'Frequency', 'Charge day', 'Save autopay']]);
    checks.push(['change-card-on-file', recurring.id, ['Card on file:', 'Next charge date', 'Create card setup link']]);
    checks.push(['record-charge', recurring.id, ['charge:', 'Customer', 'Amount']]);
    checks.push(['record-manual-charge', recurring.id, ['Manual payment record:', 'Result', 'Payment not found']]);
    checks.push(['send-pay-link', recurring.id, ['Send payment link:', 'Amount for this link', 'Create link']]);
    checks.push(['remove-autopay', recurring.id, ['Remove autopay:', 'Remove this recurring autopay?', 'Remove autopay']]);
  }
  if (setupRecurring) {
    checks.push(['delete-card-setup', setupRecurring.id, ['Delete setup:', 'Delete this card setup row?', 'Delete setup']]);
  }

  for (const [actionName, id, required] of checks) {
    await context.action(actionName, id || '', fakeButton(context, { action: actionName, id: id || '' }));
    assertHealthy('Owner action modal ' + actionName, modalHtml(context), required);
    context.closeModal();
  }

  if (contract) {
    await dispatchClick(context, { action: 'end-contract-file', id: contract.id });
    assertHealthy('Owner action click modal end-contract-file', modalHtml(context), ['End customer:', 'End date', 'End customer']);
    context.closeModal();
  }
}

async function ownerInteractionSmoke() {
  const context = makeContext({ name: 'Owner Interaction', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });

  await dispatchClick(context, { view: 'Payments' });
  assert(context.view === 'Payments', 'Owner data-view click should switch to Payments.');
  assert(context.tab === 'Active', 'Payments data-view click should default to Active tab.');
  assertHealthy('Owner clicked Payments', html(context), ['Payments & Customers', 'Active recurring customers']);

  await dispatchClick(context, { tab: 'Transactions' });
  assert(context.view === 'Payments' && context.tab === 'Transactions', 'Payments data-tab click should switch to Transactions.');
  assertHealthy('Owner clicked Transactions tab', html(context), ['Transactions']);

  await dispatchClick(context, { view: 'Operations', tab: 'Service' });
  assert(context.view === 'Operations' && context.tab === 'Service', 'Cross-view tab click should open Operations Service.');
  assertHealthy('Owner clicked Operations Service', html(context), ['Operations', 'Service work']);

  context.view = 'Dashboard';
  context.dashboardTab = 'Dues';
  context.render();
  await dispatchClick(context, { dashboardTab: 'Transactions' });
  assert(context.dashboardTab === 'Transactions', 'Dashboard sub-tab click should switch dashboardTab.');
  assertHealthy('Owner clicked dashboard transactions sub-tab', html(context), ['Transactions']);

  await dispatchClick(context, { action: 'compose-message', id: 'new' });
  assertHealthy('Owner compose click modal', modalHtml(context), ['New message', 'Text message', 'Email']);
  context.closeModal();

  const searchButton = await dispatchClick(context, { localSearchRun: '1' });
  assert(searchButton.localSearchInput.focused, 'Local search button should focus the local search field.');
  localSearchSmoke(context);
  await actionModalSmoke(context);
}

async function managerInteractionSmoke() {
  const context = makeContext({ name: 'Manager Interaction', role: 'Manager', homeView: 'Manager Portal', access: 'Manager access' });
  await dispatchClick(context, { view: 'Messages' });
  assert(context.view === 'Messages', 'Manager should be able to open Messages.');
  assertHealthy('Manager clicked Messages', html(context), ['Messages', 'message-inbox-layout', 'Reply']);
  await dispatchClick(context, { action: 'compose-message', id: 'new' });
  assertHealthy('Manager compose click modal', modalHtml(context), ['New message', 'Text message', 'Email']);
  context.closeModal();
  const recurring = context.recurringRoster().find(row => row.id);
  await dispatchClick(context, { action: 'record-charge', id: recurring && recurring.id || '' });
  assert(!modalHtml(context).includes('Manual Clover charge') && !modalHtml(context).includes('Saved card needed'), 'Manager direct record-charge action should be blocked.');
}

async function mechanicInteractionSmoke() {
  const context = makeContext({ name: 'Mechanic Interaction', role: 'Mechanic', homeView: 'Mechanic Portal', access: 'Mechanic access' });
  await dispatchClick(context, { view: 'Messages' });
  assert(context.view === 'Mechanic Portal', 'Mechanic direct Messages click should stay on mechanic portal.');
  assertHealthy('Mechanic denied Messages click', html(context), ['Mechanic Portal']);
  await dispatchClick(context, { action: 'compose-message', id: 'new' });
  assert(!modalHtml(context).includes('New message'), 'Mechanic direct compose-message action should not open the message modal.');
  const recurring = context.recurringRoster().find(row => row.id);
  await dispatchClick(context, { action: 'record-charge', id: recurring && recurring.id || '' });
  assert(!modalHtml(context).includes('Manual Clover charge') && !modalHtml(context).includes('Saved card needed'), 'Mechanic direct record-charge action should be blocked.');
}

function ownerSmoke() {
  const context = makeContext({ name: 'Owner Smoke', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  context.db.payments = context.db.payments || [];
  context.db.payments.unshift({
    id: 'smoke-paid-receipt',
    customer: 'Alicia Brown',
    date: 'Today',
    method: 'Clover saved card',
    amount: 229,
    status: 'Paid',
    vehicleId: 'veh-003',
    cloverPaymentId: 'smoke-clover-receipt'
  });
  assertCompactBoard('Owner dashboard', html(context), ['Dashboard', 'Today&rsquo;s dues & contact', 'Service due', 'Transactions', 'quickbar']);

  [
    ['Payments active', 'Payments', 'Active', ['Payments & Customers', 'Active recurring customers', 'Payment actions', 'customer-pay-list']],
    ['Payments today', 'Payments', 'Today', ['Daily closeout', 'Today action list', 'payment-command', 'customer-pay-list']],
    ['Payments history', 'Payments', 'History', ['Customer history', 'customer-pay-list']],
    ['Payments transactions', 'Payments', 'Transactions', ['Transactions', 'transaction-card', 'customer-pay-list']],
    ['Operations fleet', 'Operations', 'Fleet', ['Operations', 'Available fleet', 'staff-card-board']],
    ['Operations service', 'Operations', 'Service', ['Service work', 'staff-card-board']],
    ['Operations claims', 'Operations', 'Claims', ['Claims, tolls & issues', 'staff-card-board']],
    ['Messages Star', 'Messages', 'Star', ['Messages', 'Star AI', 'Ask Star', 'Auto-ready replies', 'Needs admin approval', 'message-thread-grid'], true],
    ['Documents', 'Documents', undefined, ['Documents', 'Document vault', 'Payment receipt', 'Receipts'], true],
    ['Settings', 'Settings', undefined, ['Settings'], false],
    ['Website', 'Website', undefined, ['Website'], false],
    ['Reports', 'Reports', undefined, ['Reports', 'Daily closeout'], false]
  ].forEach(([label, view, tab, required, compact = true]) => {
    const output = renderView(context, view, tab);
    if (compact) assertCompactBoard(label, output, required);
    else assertHealthy(label, output, required);
  });

  context.openComposeMessage('new');
  assertHealthy('Compose message modal', modalHtml(context), ['New message', 'Text message', 'Email', 'Send / save message']);

  context.openGlobalSearch();
  assertHealthy('Global search modal', modalHtml(context), ['Search everything', 'Search customer, VIN, tag, tracker', 'Result']);
}

function managerSmoke() {
  const context = makeContext({ name: 'Manager Smoke', role: 'Manager', homeView: 'Manager Portal', access: 'Manager access' });
  assertCompactBoard('Manager portal', html(context), ['Manager Portal', 'Overview', 'Today manager queue']);

  [
    ['Manager operations', 'Operations', 'Service', ['Operations', 'Service work', 'staff-card-board'], true],
    ['Manager messages', 'Messages', 'Inbox', ['Messages', 'message-inbox-layout', 'message-conversation-panel', 'Reply'], true],
    ['Manager reports', 'Reports', undefined, ['Reports', 'Executive snapshot'], false],
    ['Manager applications', 'Applications', 'Active', ['Applications', 'table-wrap'], false]
  ].forEach(([label, view, tab, required, compact = true]) => {
    const output = renderView(context, view, tab);
    if (compact) assertCompactBoard(label, output, required);
    else assertHealthy(label, output, required);
    assertNo(label, output, ['data-action="record-charge"', 'data-action="new-autopay"', 'data-action="save-clover"', 'data-view="Settings"']);
  });
}

function mechanicSmoke() {
  const context = makeContext({ name: 'Mechanic Smoke', role: 'Mechanic', homeView: 'Mechanic Portal', access: 'Mechanic access' });
  assertCompactBoard('Mechanic portal', html(context), ['Mechanic Portal', 'Priority work']);
  assertNo('Mechanic portal', html(context), ['data-view="Messages"', 'data-view="Payments"', 'data-action="compose-message"', 'data-action="record-charge"']);

  [
    ['Mechanic maintenance', 'Maintenance', 'Open', ['Maintenance', 'Open service work', 'staff-card-board']],
    ['Mechanic fleet', 'Fleet', 'Available', ['Fleet', 'Available fleet', 'staff-card-board']],
    ['Mechanic claims', 'Claims & Issues', 'Open', ['Claims & Issues', 'Open claims, tolls & issues', 'staff-card-board']]
  ].forEach(([label, view, tab, required]) => {
    const output = renderView(context, view, tab);
    assertCompactBoard(label, output, required);
    assertNo(label, output, ['data-view="Messages"', 'data-view="Payments"', 'data-action="compose-message"', 'data-action="record-charge"', 'data-action="send-pay-link"', 'class="money"']);
  });

  const blocked = renderView(context, 'Messages', 'Inbox');
  assertHealthy('Mechanic blocked Messages redirect', blocked, ['Mechanic Portal']);
  assertNo('Mechanic blocked Messages redirect', blocked, ['message-inbox-layout', 'New text/email']);
}

function publicSmoke() {
  const context = makeContext(null, true);
  assertHealthy('Public apply', html(context), ['Apply', 'WheelsonAuto', 'public']);
}

async function main() {
  ownerSmoke();
  await ownerInteractionSmoke();
  managerSmoke();
  await managerInteractionSmoke();
  mechanicSmoke();
  await mechanicInteractionSmoke();
  publicSmoke();
  console.log('Frontend render smoke passed: owner, manager, mechanic, public, key tabs, role scrub, click interactions, search, and core modals render without localhost.');
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
