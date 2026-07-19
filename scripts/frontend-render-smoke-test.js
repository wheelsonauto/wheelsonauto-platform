const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fixturePath = process.env.WOA_SMOKE_DATA
  ? path.resolve(root, process.env.WOA_SMOKE_DATA)
  : path.join(root, 'seed.json');
const seed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

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
    if (selector === '.payment-tabs button[data-tab]') return button.dataset.tab ? button : null;
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
  assert(output.length > 600, label + ' rendered too little HTML (' + output.length + ' characters): ' + output.slice(0, 180));
  assert(!/\bundefined\b/.test(output), label + ' rendered "undefined".');
  assert(!/\bNaN\b/.test(output), label + ' rendered "NaN".');
  assert(!/\[object Object\]/.test(output), label + ' rendered an object string.');
  required.forEach(text => {
    const mainStart = output.indexOf('<main');
    assert(output.includes(text), label + ' is missing: ' + text + '. Main: ' + output.slice(Math.max(0, mainStart), Math.max(0, mainStart) + 1800));
  });
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
  assert(output.includes('local-search') || output.includes('dashboard-mobile-tabs') || output.includes('message-status-strip') || output.includes('business-overview-grid'), label + ' should include local search, focused tabs, a compact status strip, or the Business overview.');
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
  const recurringSources = [
    context.db.recurringPayments,
    context.db.integrations && context.db.integrations.clover && context.db.integrations.clover.recurringPlanMembers
  ].filter(Array.isArray);
  const chargeModalFixture = recurringSources.flat().find(row => row.id && String(row.status || '').toLowerCase() === 'active')
    || recurringSources.flat().find(row => row.id);
  if (chargeModalFixture) {
    // A real customer export can legitimately contain only setup-needed rows.
    // The UI test needs one synthetic saved-card source so the positive charge
    // confirmation modal stays covered without changing the source fixture.
    Object.assign(chargeModalFixture, {
      status: 'Active',
      paymentProvider: 'clover',
      paymentSetup: 'card saved',
      cardSavedAt: '2026-07-17T00:00:00.000Z',
      cloverPaymentSource: 'clv_frontend_smoke_saved_source'
    });
  }
  const recurring = context.recurringRoster().find(row => row.id && context.canTrySavedCardCharge(row))
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
    checks.push(['complete-maintenance', maintenance.id, ['Complete maintenance:', 'Completed date', 'Inspection checklist', 'Mark done']]);
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

  if (context.db.recurringPayments && context.db.recurringPayments[0]) {
    context.db.recurringPayments[0].paymentAttempts = { legacy: 'not-an-array' };
  }
  context.db.payments.unshift({
    id: 'legacy-unmatched-payment-shape',
    date: '7/11/2026',
    customer: 'Unmatched Clover payment',
    method: 'Debit Card',
    amount: 45.53,
    status: 'Paid'
  });
  await dispatchClick(context, { tab: 'Transactions' });
  assert(context.view === 'Payments' && context.tab === 'Transactions', 'Payments data-tab click should switch to Transactions.');
  assertHealthy('Owner clicked Transactions tab', html(context), ['Transactions']);
  assert(/<h2>Transactions<\/h2>/.test(html(context)), 'Payments Transactions click must render the Transactions panel.');
  assert(!/<h2>Customer history<\/h2>/.test(html(context)), 'Payments Transactions click must replace the previous History panel.');
  const transactionDisplayError = html(context).match(/data-display-error="([^"]*)"/);
  assert(!/Transaction needs review/.test(html(context)), 'Legacy paymentAttempts shapes must not break unmatched transaction rendering: ' + (transactionDisplayError ? transactionDisplayError[1] : 'unknown display error'));
  assert(/\$45\.53/.test(html(context)), 'Legacy unmatched transactions must remain visible after normalization.');

  await dispatchClick(context, { view: 'Operations', tab: 'Service' });
  assert(context.view === 'Operations' && context.tab === 'Service', 'Cross-view tab click should open Operations Service.');
  assertHealthy('Owner clicked Operations Service', html(context), ['Operations', 'Service work']);

  await dispatchClick(context, { tab: 'Verification' });
  assert(context.view === 'Operations' && context.tab === 'Verification', 'Operations Verification click should open the integrated review workspace.');
  assertHealthy('Owner clicked Operations Verification', html(context), ['Insurance', 'Verification review']);
  await dispatchClick(context, { tab: 'Verify background' });
  assert(context.view === 'Operations' && context.tab === 'Verify background', 'Operations Background click must stay inside the verification workspace.');
  assertHealthy('Owner clicked Operations Background', html(context), ['Insurance', 'Background checks', 'last four']);

  context.view = 'Dashboard';
  context.render();
  assertHealthy('Owner Dashboard overview', html(context), ['Dashboard', 'Business overview', 'Money today', 'Payment attention']);
  assert(!html(context).includes('dashboard-mobile-tabs'), 'Business must not repeat Dashboard work-list tabs.');
  await dispatchClick(context, { view: 'Payments', tab: 'Today' });
  assert(context.view === 'Payments' && context.tab === 'Today', 'Business payment tile should open Payments Today.');
  assertHealthy('Owner opened Payments from Business', html(context), ['Today action list']);

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
  assertHealthy('Manager clicked Messages', html(context), ['Messages', 'message-inbox-shell', 'message-empty-state']);
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
  assert(context.safeLink('https://wheelsonauto.com/toll-proof') === 'https://wheelsonauto.com/toll-proof' && context.safeLink('/toll-receipt/private-token') === '/toll-receipt/private-token', 'Trusted HTTP(S) and same-site proof links should remain clickable.');
  assert(context.safeLink('javascript:alert(1)') === '' && context.safeLink('//malicious.example/proof') === '', 'Script and protocol-relative proof links must not become clickable.');
  context.tollReceiptModal({ id: 'unsafe-proof', customer: 'Unsafe Proof Test', amount: 1, proofUrl: 'javascript:alert(1)' });
  assert(!modalHtml(context).includes('javascript:') && !modalHtml(context).includes('Preview receipt'), 'Unsafe stored toll proof URLs must render without a clickable preview action.');
  context.db.integrations = context.db.integrations || {};
  context.db.integrations.apiProviderRuntime = [{ id: 'clover-core', name: 'Clover Core', group: 'Money', status: 'Connected', lastTestAt: '2026-07-14T12:00:00.000Z', lastTestResult: 'Runtime sync proof passed.' }];
  assert(context.apiProviders().find(row => row.id === 'clover-core').status === 'Connected', 'API Roadmap should use the live server provider status instead of the generic client default.');
  assert(context.apiProviders().find(row => row.id === 'insurance').endpoint.includes('/api/verification/cases'), 'Client fallback provider rows must point insurance to the live verification adapter.');
  assert(context.apiProviders().find(row => row.id === 'identity-verification').endpoint.includes('/api/webhooks/stripe') && context.apiProviders().find(row => row.id === 'identity-verification').endpoint.includes('/identity'), 'Client fallback provider rows must expose Stripe Identity onboarding and signed Stripe callbacks.');
  assert(context.apiProviders().find(row => row.id === 'background-checks').endpoint.includes('/api/verification/cases'), 'Client fallback provider rows must point background screening to the shared secure verification adapter.');
  assert(context.apiProviders().find(row => row.id === 'background-checks').status === 'Ready - provider setup', 'Background screening must keep manual review usable while honestly showing that authoritative Checkr results still need provider setup.');
  assert(context.apiProviders().find(row => row.id === 'tracker-gps').endpoint.includes('/api/webhooks/tracker'), 'Client fallback provider rows must expose the live tracker adapter and signed callback.');
  assert(context.apiProviders().find(row => row.id === 'marketing').endpoint.includes('/api/webhooks/marketing'), 'Client fallback provider rows must expose the live marketing lead adapter and signed callback.');
  context.db.applications = context.db.applications || [];
  context.db.websiteLeads = context.db.websiteLeads || [];
  context.db.applications.unshift({ id: 'app-marketing-render', name: 'Marketing Render Lead', stage: 'New', phone: '8565550181' });
  context.db.websiteLeads.unshift(
    { id: 'lead-marketing-render-new', applicationId: 'app-marketing-render', source: 'Newest provider source', campaign: 'Latest campaign', status: 'Application submitted', createdAt: '2026-07-16T15:00:00.000Z' },
    { id: 'lead-marketing-render-old', applicationId: 'app-marketing-render', source: 'Older provider source', status: 'Submitted', createdAt: '2026-07-15T15:00:00.000Z' }
  );
  const renderedMarketingLead = context.marketingLeadCommandItems().find(row => row.id === 'app-marketing-render');
  assert(renderedMarketingLead && renderedMarketingLead.source.includes('Newest provider source') && renderedMarketingLead.source.includes('Latest campaign') && !renderedMarketingLead.source.includes('Older provider source'), 'The Marketing board should show the newest linked provider attribution without duplicating the application card.');
  assert(context.apiProviders().find(row => row.id === 'accounting').endpoint.includes('/api/accounting/quickbooks.csv'), 'Client fallback provider rows must expose the balanced QuickBooks journal export.');
  assert(context.apiProviders().find(row => row.id === 'pickup-calendar').endpoint.includes('/api/pickups/calendar'), 'Client fallback provider rows must expose pickup calendar and maps routes.');
  const detailedProviderForm = context.apiProviderForm({ id: 'clover-ecommerce', name: 'Clover Ecommerce', status: 'Testing - live charge needed' });
  assert(detailedProviderForm.includes('type="hidden" value="Testing - live charge needed"') && detailedProviderForm.includes('Calculated from live credentials'), 'Built-in API status must preserve the exact runtime status as evidence-controlled read-only state.');
  assert(!detailedProviderForm.includes('<select id="apiStatus">') && !detailedProviderForm.includes('<option selected>Connected</option>'), 'An unfinished built-in provider must never expose a manual Connected selector.');
  const customProviderForm = context.apiProviderForm({ id: 'custom-provider', name: 'Custom provider', status: 'Testing - owner review' });
  assert(customProviderForm.includes('<select id="apiStatus">') && customProviderForm.includes('<option selected>Testing - owner review</option>'), 'Custom provider records should retain an editable exact status.');
  assert(context.isInventoryVehicle({ status: 'Ready', currentCustomer: '' }) === true, 'Ready unassigned cars should be available inventory.');
  assert(context.isInventoryVehicle({ status: 'Pending application', currentCustomer: '' }) === false, 'Pending-application cars must not appear in available fleet or autopay pickers.');
  assert(context.isInventoryVehicle({ status: 'Maintenance', currentCustomer: '' }) === false, 'Maintenance cars must not appear in available fleet or autopay pickers.');
  assert(context.isInventoryVehicle({ status: 'Active contract', currentCustomer: '' }) === false, 'Unmatched active-contract cars must stay in review instead of available fleet.');
  assert(context.Operations === context.OperationsTruthFocused, 'Operations must use the final mutually exclusive fleet categorization.');
  assertHealthy('Operations prep/review truth split', renderView(context, 'Operations', 'Review'), ['Prep / review', 'Unassigned cars that need prep']);
  context.db.recurringPayments = context.db.recurringPayments || [];
  const weakVehicleRow = { customer: 'Weak Vehicle Label Smoke', vehicle: '230', plan: '$230.00', amount: 230, status: 'Active' };
  assert(context.enrichedVehicleForRecurring(weakVehicleRow) === 'No vehicle linked', 'A numeric payment amount must not render as a vehicle label on Dashboard, Payments, Reports, or Messages.');
  assert(context.paymentVehicleInfo({}, weakVehicleRow, {}, {}).vehicle === 'No vehicle linked', 'Customer payment cards must replace numeric vehicle text with an honest unlinked label.');
  context.db.contracts = context.db.contracts || [];
  context.db.documents = context.db.documents || [];
  context.db.verificationCases = context.db.verificationCases || [];
  context.db.contracts.unshift(
    { id: 'contract-license-proof-smoke', customer: 'Driver Proof Smoke', status: 'Active', vehicle: '2018 Proof Car' },
    { id: 'contract-background-only-smoke', customer: 'Background Only Smoke', status: 'Active', vehicle: '2019 Background Car' },
    { id: 'contract-expiring-case-smoke', customer: 'Expiring Case Smoke', status: 'Active', vehicle: '2020 Expiring Car' }
  );
  context.db.documents.unshift(
    { id: 'doc-license-proof-smoke', type: 'Driver license', customer: 'Driver Proof Smoke', status: 'Verified', expires: context.addMonthsKey(context.todayKey(), 12) },
    { id: 'doc-background-only-smoke', type: 'Background check', customer: 'Background Only Smoke', status: 'Verified', expires: context.addMonthsKey(context.todayKey(), 12) }
  );
  context.db.verificationCases.unshift({ id: 'verify-expiring-smoke', type: 'driver_license', customer: 'Expiring Case Smoke', status: 'Verified', expiresAt: context.todayKey() });
  assert(!context.verificationMissingRows('driver_license').some(row => row.customer === 'Driver Proof Smoke'), 'Verified driver-license proof must satisfy the ID/license requirement.');
  assert(context.verificationMissingRows('driver_license').some(row => row.customer === 'Background Only Smoke'), 'A background check must not be mistaken for driver-license or identity proof.');
  assert(context.integratedVerificationStatus(context.db.verificationCases[0]) === 'Expiring', 'A persisted Verified case inside the expiration window must render as Expiring without waiting for a data rewrite.');
  assert(!context.verificationMissingRows('driver_license').some(row => row.customer === 'Expiring Case Smoke'), 'An expiring linked license must remain linked while appearing in the review queue.');
  const expirationReview = renderView(context, 'Insurance', 'Review');
  assert(expirationReview.includes('Expiring Case Smoke') && expirationReview.includes('Expiring'), 'The verification review must surface current expiration status from the saved date.');
  const backgroundReview = renderView(context, 'Insurance', 'Background');
  assert(backgroundReview.includes('Background checks') && backgroundReview.includes('Background Only Smoke') && backgroundReview.includes('last four'), 'Background screening must render as a dedicated manual/provider-neutral review surface.');
  context.db.recurringPayments.unshift({
    id: 'smoke-removed-today',
    customer: 'Removed Today Smoke',
    amount: 987654,
    nextRun: 'Removed',
    lastAutoChargeAttemptDate: context.todayKey(),
    retryCount: 2,
    status: 'Active'
  });
  assert(context.dueOrTouchedToday(context.db.recurringPayments[0]) === false, 'Removed recurring customers must not qualify for Today even after a same-day failed attempt.');
  assert(context.isCurrentAutopayRow(context.db.recurringPayments[0]) === false && context.paymentState(context.db.recurringPayments[0]).key === 'history', 'Legacy removed markers in the schedule field must classify the customer as history, not active or failed.');
  assert(!renderView(context, 'Dashboard', 'Board', 'Dues').includes('Removed Today Smoke'), 'Dashboard Today dues must exclude removed recurring customers.');
  assert(!renderView(context, 'Payments', 'Today').includes('Removed Today Smoke'), 'Payments Today action list must exclude removed recurring customers.');
  const removedHistory = renderView(context, 'Payments', 'History');
  assert(removedHistory.includes('Removed Today Smoke') && removedHistory.includes('History / removed'), 'Removed recurring customers must remain visible in customer history with the normalized inactive status.');
  context.db.payments = context.db.payments || [];
  context.db.payments.unshift({
    id: 'smoke-removed-history-transaction',
    customer: 'Removed Today Smoke',
    date: '2000-01-01',
    method: 'Clover saved card',
    amount: 99,
    status: 'FAIL'
  });
  assert(renderView(context, 'Payments', 'Transactions').includes('Removed Today Smoke'), 'Removed customer transactions must remain visible in transaction history.');
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
  context.db.payments.unshift(
    { id: 'smoke-clover-duplicate-a', customer: 'Unmatched Clover payment', date: '2000-01-01', method: 'Clover', source: 'Clover', amount: 77, status: 'Paid', cloverPaymentId: 'smoke-clover-provider-duplicate' },
    { id: 'smoke-clover-duplicate-b', customer: 'Customer match needed', date: '2000-01-01', method: 'Clover', source: 'Clover', amount: 77, status: 'Paid', cloverPaymentId: 'smoke-clover-provider-duplicate' }
  );
  const dedupedCloverWorkspace = renderView(context, 'Claims & Issues', 'Clover');
  assert(countOf(dedupedCloverWorkspace, 'smoke-clover-provider-duplicate') === 1, 'Clover reconciliation UI must render a provider payment id only once after duplicate sync rows merge.');
  const ownerDashboard = renderView(context, 'Dashboard', 'Board');
  assertCompactBoard('Owner dashboard', ownerDashboard, ['Dashboard', 'Business overview', 'Customer intake', 'Money today', 'Ready fleet', 'quickbar']);
  assertNo('Owner dashboard', ownerDashboard, ['Today&rsquo;s dues & contact', 'Today action list', 'Star command queue', 'Platform readiness map', 'Core system board', 'Launch readiness']);

  [
    ['Payments active', 'Payments', 'Active', ['Payments & Customers', 'Active recurring customers', 'Payments & customers', 'customer-pay-list']],
    ['Payments today', 'Payments', 'Today', ['Payments & Customers', 'Today action list', 'payment-command', 'customer-pay-list']],
    ['Payments history', 'Payments', 'History', ['Customer history', 'customer-pay-list']],
    ['Payments transactions', 'Payments', 'Transactions', ['Transactions', 'transaction-card', 'customer-pay-list']],
    ['Operations fleet', 'Operations', 'Fleet', ['Operations', 'Available fleet', 'staff-card-board']],
    ['Operations service', 'Operations', 'Service', ['Operations', 'Service work', 'staff-card-board']],
    ['Operations claims', 'Operations', 'Claims', ['Claims & Issues', 'Open claims, tolls &amp; issues', 'staff-card-board']],
    ['Operations payments', 'Operations', 'Payments', ['Claims & Issues', 'Payment reconciliation', 'Webhooks', 'integration-workspace']],
    ['Operations verification', 'Operations', 'Verification', ['Verification', 'Verification review', 'integration-workspace']],
    ['Maintenance route', 'Maintenance', 'Open', ['Maintenance', 'Open service work', 'staff-card-board'], true],
    ['Dispatch command', 'Dispatch', undefined, ['Dispatch', 'Dispatch command', 'Work orders from tasks', 'Priority queue', 'Dispatch tasks'], true],
    ['Claims open', 'Claims & Issues', 'Open', ['Claims & Issues', 'Open claims, tolls &amp; issues', 'staff-card-board'], true],
    ['Claims payments', 'Claims & Issues', 'Payments', ['Claims & Issues', 'Payment reconciliation', 'Clover and Stripe', 'Webhooks', 'Disputes', 'Refunds', 'Unmatched', 'integration-workspace'], true],
    ['Verification review', 'Insurance', 'Review', ['Verification', 'Verification review', 'Missing verified proof', 'Missing driving record', 'integration-workspace'], true],
    ['Verification insurance', 'Insurance', 'Insurance', ['Verification', 'Insurance monitoring', 'Customer-authorized provider checks', 'integration-workspace'], true],
    ['Verification identity', 'Insurance', 'Identity', ['Verification', 'Driver record &amp; identity', 'last four characters', 'integration-workspace'], true],
    ['Verification background', 'Insurance', 'Background', ['Verification', 'Background checks', 'background check', 'last four characters', 'integration-workspace'], true],
    ['Messages Star', 'Messages', 'Star', ['Messages', 'Ask Star', 'Review queue', 'message-star-focused', 'message-thread-grid'], false],
    ['Messages queue', 'Messages', 'Queue', ['Messages', 'Follow-up', 'message-focused-list'], false],
    ['Documents review', 'Documents', 'Review', ['Documents', 'Verification inbox', 'Customer proof'], true],
    ['Documents vault', 'Documents', 'Vault', ['Documents', 'Document vault', 'Payment receipt'], true],
    ['Documents requests', 'Documents', 'Requests', ['Documents', 'Customer portal requests', 'Search portal requests'], true],
    ['Tolls open', 'Tolls', 'Open', ['Tolls', 'Toll recovery command', 'Toll follow-up route', 'Open recovery', 'Missing file', 'Ready to collect', 'toll-recovery-list'], true],
    ['Tolls missing file', 'Tolls', 'Missing file', ['Tolls', 'Missing file tolls and violations', 'Search tolls by customer', 'Provider setup'], true],
    ['Marketing', 'Marketing', undefined, ['Marketing command', 'Lead follow-up command', 'Lead board', 'Search follow-up by customer', 'Search leads by customer'], true],
    ['Companies overview', 'Companies', 'Overview', ['Companies', 'Company control', 'Setup attention', 'company-overview-row'], false],
    ['Companies accounts', 'Companies', 'Accounts', ['Companies', 'Company accounts', 'company-accounts-panel', 'Add company'], false],
    ['Companies staff', 'Companies', 'Staff', ['Companies', 'Staff by company', 'company-staff-panel', 'Add staff'], false],
    ['Companies readiness', 'Companies', 'Readiness', ['Companies', 'Franchise readiness', 'company-readiness-grid', 'Subscription billing', 'company-billing-console', 'Manual ledger', 'Current rule'], false],
    ['API roadmap providers', 'API Roadmap', 'Providers', ['API Roadmap', 'Provider checklist', 'Total systems', 'Setup'], true],
    ['Settings', 'Settings', undefined, ['Settings'], false],
    ['Website overview', 'Website', 'Overview', ['Website', 'Native WheelsonAuto website', 'Published fleet'], false],
    ['Website inventory', 'Website', 'Inventory', ['Website', 'Online fleet', 'native-inventory-board'], false],
    ['Website applications', 'Website', 'Applications', ['Website', 'Website applications', 'native-website-apps'], false],
    ['Website performance', 'Website', 'Performance', ['Website', 'Website performance', 'Application to onboarding'], false],
    ['Dashboard overview', 'Dashboard', 'Overview', ['Dashboard', 'Business overview', 'Money today'], false],
    ['Dashboard closeout', 'Dashboard', 'Closeout', ['Dashboard', 'Daily closeout', 'Expected today'], false],
    ['Dashboard accounting', 'Dashboard', 'Accounting', ['Dashboard', 'Accounting ledger', 'One source of truth', '/api/accounting/quickbooks.csv', 'tamper-evident source hash', 'integration-workspace'], false],
    ['Dashboard risk', 'Dashboard', 'Risk', ['Dashboard', 'Risk', 'Star system auditor'], false],
    ['Legacy owner Reports redirect', 'Reports', 'Accounting', ['Dashboard', 'Accounting ledger', 'One source of truth'], false]
  ].forEach(([label, view, tab, required, compact = true]) => {
    const output = renderView(context, view, tab);
    if (compact) assertCompactBoard(label, output, required);
    else assertHealthy(label, output, required);
  });
  context.dashboardDetailState.Accounting = 'Cars';
  assertHealthy('Dashboard accounting cars', renderView(context, 'Dashboard', 'Accounting'), ['Dashboard', 'Car profitability & recovery', 'Collected', 'Service cost']);
  context.dashboardDetailState.Accounting = 'Books';
  context.dashboardDetailState.Risk = 'Disputes';
  assertHealthy('Dashboard risk disputes', renderView(context, 'Dashboard', 'Risk'), ['Dashboard', 'Dispute identity resolver', 'Name-missing disputes']);
  context.dashboardDetailState.Risk = 'Customers';
  assertHealthy('Dashboard customer risk', renderView(context, 'Dashboard', 'Risk'), ['Dashboard', 'Customer risk report', 'payment setup']);
  context.dashboardDetailState.Risk = 'Health';
  const ownerClaimsOpen = renderView(context, 'Claims & Issues', 'Open');
  assertNo('Owner Claims duplicate boards', ownerClaimsOpen, ['Dispute identity resolver', 'Dispute evidence package', 'Dispute / recovery bridge']);
  const ownerPickups = renderView(context, 'Applications', 'Pickups');
  assertHealthy('Owner pickup schedule', ownerPickups, ['Applications', 'Pickup schedule', '5150 NJ-42', 'next-day minimum', 'integration-workspace']);

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
    ['Manager tolls', 'Tolls', 'Open', ['Tolls', 'Toll recovery command', 'Open recovery', 'toll-recovery-list'], true],
    ['Manager claims', 'Claims & Issues', 'Open', ['Claims & Issues', 'Open claims, tolls &amp; issues', 'staff-card-board'], true],
    ['Manager payment review', 'Claims & Issues', 'Payments', ['Claims & Issues', 'Payment reconciliation', 'Webhooks', 'integration-workspace'], true],
    ['Manager verification', 'Insurance', 'Review', ['Verification', 'Verification review', 'integration-workspace'], true],
    ['Manager background verification', 'Insurance', 'Background', ['Verification', 'Background checks', 'integration-workspace'], true],
    ['Manager messages', 'Messages', 'Inbox', ['Messages', 'message-inbox-shell', 'message-conversation-panel', 'message-empty-state'], false],
    ['Manager reports', 'Reports', 'Summary', ['Reports', 'Operations snapshot'], false],
    ['Manager accounting', 'Reports', 'Accounting', ['Reports', 'Accounting ledger', 'QuickBooks'], false],
    ['Manager applications', 'Applications', 'Pipeline', ['Applications', 'New applications', 'native-applications-board'], false],
    ['Manager pickups', 'Applications', 'Pickups', ['Applications', 'Pickup schedule', '5150 NJ-42'], false]
  ].forEach(([label, view, tab, required, compact = true]) => {
    const output = renderView(context, view, tab);
    if (compact) assertCompactBoard(label, output, required);
    else assertHealthy(label, output, required);
    assertNo(label, output, ['data-action="record-charge"', 'data-action="new-autopay"', 'data-action="new-toll"', 'data-action="new-toll-import"', 'data-action="send-claim-link"', 'data-action="save-clover"', 'data-action="integrated-open-refund"', 'data-action="integrated-open-dispute"', 'data-action="integrated-rebuild-accounting"']);
  });
  assertNo('Manager portal duplicate queue', html(context), ['Manager command queue']);
  const managerAccount = renderView(context, 'Settings', 'Account');
  assertHealthy('Manager Account settings', managerAccount, ['Settings', 'Account access', 'Reset password', 'Log out']);
  assertNo('Manager Account settings', managerAccount, ['Clover connection', 'Staff accounts', 'Customer portal logins', 'Website connection']);
}

function mechanicSmoke() {
  const context = makeContext({ name: 'Mechanic Smoke', role: 'Mechanic', homeView: 'Mechanic Portal', access: 'Mechanic access' });
  assertCompactBoard('Mechanic portal', html(context), ['Mechanic Portal', 'Priority work']);
  assertNo('Mechanic portal', html(context), ['Mechanic shop queue', 'data-view="Messages"', 'data-view="Payments"', 'data-action="compose-message"', 'data-action="record-charge"', 'data-action="open-contract"', 'data-action="open-contract-for-name"']);

  [
    ['Mechanic maintenance', 'Maintenance', 'Open', ['Maintenance', 'Open service work', 'staff-card-board']],
    ['Mechanic fleet', 'Fleet', 'Available', ['Fleet', 'Available fleet', 'staff-card-board']],
    ['Mechanic claims', 'Claims & Issues', 'Open', ['Claims & Issues', 'Open vehicle issues', 'staff-card-board']]
  ].forEach(([label, view, tab, required]) => {
    const output = renderView(context, view, tab);
    assertCompactBoard(label, output, required);
    assertNo(label, output, ['data-view="Messages"', 'data-view="Payments"', 'data-action="compose-message"', 'data-action="record-charge"', 'data-action="send-pay-link"', 'data-action="send-claim-link"', 'class="money"', 'tolls & issues', 'Import tolls', 'Clover dispute']);
    if (view === 'Maintenance') assertNo(label + ' duplicate work lists', output, ['Inspection command', 'Service route']);
  });

  const blocked = renderView(context, 'Messages', 'Inbox');
  assertHealthy('Mechanic blocked Messages redirect', blocked, ['Mechanic Portal']);
  assertNo('Mechanic blocked Messages redirect', blocked, ['message-inbox-layout', 'New text/email']);
  const mechanicAccount = renderView(context, 'Settings', 'Account');
  assertHealthy('Mechanic Account settings', mechanicAccount, ['Settings', 'Account access', 'Reset password', 'Log out']);
  assertNo('Mechanic Account settings', mechanicAccount, ['Clover connection', 'Staff accounts', 'Customer portal logins', 'Website connection']);
}

function publicSmoke() {
  const context = makeContext(null, true);
  assertHealthy('Public apply', html(context), ['Apply', 'WheelsonAuto', 'public']);
}

function recoveryConsoleSmoke() {
  const context = makeContext({ name: 'Owner Recovery', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  const recovery = context.recoveryConsoleModal({
    ok: true,
    message: 'Controlled recovery fixture.',
    snapshots: [
      { id: 91, version: 184, checksum: 'f36a97584815d79ad622ee1a70b73438d57c7012c4816a8fc0f40f691071cb4a', reason: 'pre-cutover safety snapshot', actor: 'Owner', createdAt: '2026-07-18T22:14:00.000Z' },
      { id: 90, version: 180, checksum: '3bc1d765fe4c9d2de5aba728223d7f02d20bf1bda10c2676c10ccb476fb12345', reason: 'verified JSON import', actor: 'Migration worker', createdAt: '2026-07-18T19:30:00.000Z' }
    ],
    history: [
      { id: 12, eventType: 'snapshot_restore', result: 'completed', previousVersion: 180, targetVersion: 181, actor: 'Owner', createdAt: '2026-07-18T20:15:00.000Z', details: { reason: 'owner-confirmed snapshot recovery', accessControlPreserved: true, sessionsRevoked: true } }
    ]
  });
  assertHealthy('Owner recovery console', recovery, ['recovery-console-summary', 'Append-only history', 'recoverySnapshotSelect', 'Version 184', 'pre-cutover safety snapshot', 'Snapshot Restore', 'Access controls preserved', 'Sessions revoked', 'review-selected-snapshot']);
  assert(!recovery.includes('f36a97584815d79ad622ee1a70b73438d57c7012c4816a8fc0f40f691071cb4a'), 'Recovery UI must display only a short checksum prefix, not the complete database checksum.');
  const confirmation = context.snapshotRestoreConfirmationModal({
    value: '91',
    dataset: { version: '184', reason: 'pre-cutover safety snapshot', actor: 'Owner', created: '2026-07-18T22:14:00.000Z', checksumPrefix: 'f36a97584815...' }
  });
  assertHealthy('Owner recovery confirmation', confirmation, ['RESTORE SNAPSHOT 91', 'recoveryConfirmationPhrase', 'recoveryConfirmationChecked', 'Current staff/customer access controls are preserved', 'every signed-in session is revoked', 'confirm-snapshot-restore']);
  assert(!confirmation.includes('f36a97584815d79ad622ee1a70b73438d57c7012c4816a8fc0f40f691071cb4a'), 'Recovery confirmation must not expose the complete database checksum.');
}

async function refreshCoordinationSmoke() {
  const context = makeContext({ name: 'Owner Refresh', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  context.__woaLastDataVersion = 'same-version';
  let versionCalls = 0;
  let releaseVersion;
  context.fetch = async url => {
    if (url !== '/api/state/version') throw new Error('Unexpected refresh URL: ' + url);
    versionCalls += 1;
    await new Promise(resolve => { releaseVersion = resolve; });
    return { ok: true, json: async () => ({ version: 'same-version' }) };
  };

  const first = context.refreshData(true);
  const second = context.refreshData(true);
  assert(versionCalls === 1, 'Concurrent silent refreshes must share one version request.');
  releaseVersion();
  await Promise.all([first, second]);

  context.document.hidden = true;
  context.localStorage.setItem('woa-runtime-lease:state-poll', JSON.stringify({ owner: 'another-tab', expiresAt: Date.now() + 30000 }));
  assert((await context.refreshData(true)) === false, 'A background follower tab must not duplicate the current state poll.');
  assert(versionCalls === 1, 'A blocked background refresh must not make a network request.');

  const manager = makeContext({ name: 'Manager Refresh', role: 'Manager', homeView: 'Manager Portal', access: 'Manager access' });
  let managerCalls = 0;
  manager.fetch = async () => {
    managerCalls += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  assert((await manager.autoApiSync(false)) === false, 'A manager tab must not run owner provider auto-sync.');
  assert(managerCalls === 0, 'A manager auto-sync attempt must not call a provider route.');

  const owner = makeContext({ name: 'Owner Provider', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  owner.localStorage.setItem('woa-runtime-lease:provider-auto-sync', JSON.stringify({ owner: 'another-owner-tab', expiresAt: Date.now() + 30000 }));
  let ownerCalls = 0;
  owner.fetch = async () => {
    ownerCalls += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  assert((await owner.autoApiSync(false)) === false, 'A second owner tab must respect the provider sync lease.');
  assert(ownerCalls === 0, 'A leased provider sync must not call an external sync route twice.');
}

function heavyMessagesReportsSmoke() {
  const context = makeContext({ name: 'Owner Heavy Smoke', role: 'Owner', homeView: 'Dashboard', access: 'Owner access' });
  const customers = context.db.contracts || [];
  context.db.messages = Array.from({ length: 5000 }, (_, i) => {
    const customer = customers[i % Math.max(1, customers.length)] || {};
    const name = customer.customer || 'Heavy Customer ' + i;
    return {
      id: 'heavy-msg-' + i,
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
      date: 'Today',
      customer: name,
      phone: '(555) 100-' + String(i % 10000).padStart(4, '0'),
      direction: i % 3 === 0 ? 'Inbound' : 'Outbound',
      channel: i % 5 === 0 ? 'Star AI' : 'SMS',
      status: i % 7 === 0 ? 'Needs admin approval' : (i % 3 === 0 ? 'Received' : 'Draft'),
      body: 'Heavy render message for ' + name + ' about payment, vehicle, VIN, tag, service, and follow-up #' + i,
      aiPlan: i % 7 === 0 ? { approvalRequired: true, actionType: 'draft_reply' } : null
    };
  });
  const started = Date.now();
  const inbox = renderView(context, 'Messages', 'Inbox');
  assertHealthy('Heavy Messages inbox', inbox, ['Messages', 'message-inbox-shell', 'message-conversation-panel', 'message-thread-row']);
  assert(inbox.length < 220000, 'Heavy Messages inbox rendered too much HTML at once.');
  const history = renderView(context, 'Messages', 'History');
  assertHealthy('Heavy Messages history', history, ['Message history', 'saved inbound, outbound, email, SMS, draft, and Star records']);
  assert(history.length < 220000, 'Heavy Messages history rendered too much HTML at once.');
  const star = renderView(context, 'Messages', 'Star');
  assertHealthy('Heavy Messages Star', star, ['Ask Star', 'Review queue', 'Money and account changes remain approval-only']);
  assert(star.length < 240000, 'Heavy Messages Star rendered too much HTML at once.');
  const queueStarted = Date.now();
  const queue = renderView(context, 'Messages', 'Queue');
  const firstQueueMs = Date.now() - queueStarted;
  assertHealthy('Heavy Messages queue', queue, ['Follow-up', 'Failed payments, card setup, open links']);
  assert(queue.length < 220000, 'Heavy Messages queue rendered too much HTML at once.');
  const cachedQueueStarted = Date.now();
  const cachedQueue = renderView(context, 'Messages', 'Queue');
  const cachedQueueMs = Date.now() - cachedQueueStarted;
  assertHealthy('Cached heavy Messages queue', cachedQueue, ['Follow-up', 'Failed payments, card setup, open links']);
  assert(cachedQueueMs <= Math.max(250, firstQueueMs), 'Messages queue cache did not make repeated navigation proportional to visible work.');
  ['Overview', 'Closeout', 'Accounting', 'Risk'].forEach(tabName => {
    const report = renderView(context, 'Dashboard', tabName);
    assertHealthy('Heavy Dashboard ' + tabName, report, ['Dashboard', tabName]);
    assert(report.length < 260000, 'Heavy Dashboard ' + tabName + ' rendered too much HTML at once.');
  });
  const websitePerformance = renderView(context, 'Website', 'Performance');
  assertHealthy('Heavy Website performance', websitePerformance, ['Website', 'Performance', 'Application to onboarding']);
  assert(websitePerformance.length < 260000, 'Heavy Website performance rendered too much HTML at once.');
  assert(Date.now() - started < 3000, 'Heavy Messages/Business render path took too long.');
}

async function main() {
  ownerSmoke();
  await ownerInteractionSmoke();
  managerSmoke();
  await managerInteractionSmoke();
  mechanicSmoke();
  await mechanicInteractionSmoke();
  publicSmoke();
  recoveryConsoleSmoke();
  await refreshCoordinationSmoke();
  heavyMessagesReportsSmoke();
  console.log('Frontend render smoke passed: owner, manager, mechanic, public, recovery console, heavy Messages/Reports, key tabs, role scrub, click interactions, search, and core modals render without localhost.');
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
