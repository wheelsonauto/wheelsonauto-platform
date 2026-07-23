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
    location: {
      href: '/',
      origin: 'https://wheelsonauto-platform.onrender.com',
      replace(value) { this.href = String(value || ''); }
    }
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
    ['reset-password', '', ['owner username & password', 'New password', 'Save owner login']],
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
  assertHealthy('Owner compose click modal', modalHtml(context), ['New message', 'Optional SMS', 'Email']);
  context.closeModal();

  const defaultFetch = context.fetch;
  context.fetch = async url => String(url).includes('/api/integrations/stripe/readiness')
    ? { ok: true, status: 200, json: async () => ({ ok: true, stripeAccount: { keyMode: 'test', checkedKeyMode: 'test', detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, currentlyDueCount: 1, successful: true, configurationMatched: true, fresh: true, checkedAt: '2026-07-20T12:00:00.000Z', live: false, error: 'Activate Stripe first.' }, stripeWebhookDestination: { endpointMatched: false, active: false, exactEvents: false, enabledEventCount: 0, requiredEventCount: 21, configurationMatched: true, fresh: true, live: false, error: 'Deploy the Stripe live secret key before checking the webhook destination.' } }) }
    : defaultFetch(url);
  await context.action('check-stripe-readiness', '', fakeButton(context, { action: 'check-stripe-readiness' }));
  assertHealthy('Owner clicked Stripe account check', modalHtml(context), ['Stripe launch connection', 'Stripe launch connection is not complete yet', 'Webhook destination', 'Webhook events', 'Safe check only', 'Open Stripe webhooks']);
  context.closeModal();
  context.fetch = defaultFetch;

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
  assertHealthy('Manager compose click modal', modalHtml(context), ['New message', 'Optional SMS', 'Email']);
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
  const context = makeContext({ name: 'Owner Smoke', username: 'owner', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access', ownerAccess: { passwordLoginConfigured: true, passwordLoginStrong: true, passwordLoginVerified: true, passwordLoginVerifiedAt: '2026-07-19T09:30:00.000Z', passwordSessionVerified: true, pinFallbackAllowed: true, canDisablePinFallback: true } });
  const originalRecurringRows = context.db.recurringPayments;
  context.db.integrations = context.db.integrations || {};
  context.db.integrations.clover = context.db.integrations.clover || {};
  const originalCloverMembers = context.db.integrations.clover.recurringPlanMembers;
  const providerMirror = {
    id: 'provider-mirror-plan-a',
    customer: 'Clover recurring customer',
    amount: 229,
    status: 'Active',
    cloverSubscriptionId: 'frontend-shared-plan-a',
    cloverPaymentSource: 'frontend-provider-source-a'
  };
  const localPlanA = {
    id: 'local-plan-a',
    customer: 'Frontend Multi Plan Customer',
    amount: 239,
    status: 'Active',
    cloverSubscriptionId: 'frontend-shared-plan-a',
    notes: 'WheelsonAuto operating schedule'
  };
  const localPlanB = {
    id: 'local-plan-b',
    customer: 'Frontend Multi Plan Customer',
    amount: 189,
    status: 'Active',
    cloverSubscriptionId: 'frontend-shared-plan-b'
  };
  context.db.integrations.clover.recurringPlanMembers = [providerMirror];
  context.db.recurringPayments = [localPlanA, localPlanB];
  const reconciledMultiPlanRoster = context.recurringRoster();
  assert(reconciledMultiPlanRoster.length === 2, 'The browser roster must merge the provider/local mirror for one exact Clover subscription without collapsing a second real plan.');
  const reconciledPlanA = reconciledMultiPlanRoster.find(row => row.cloverSubscriptionId === 'frontend-shared-plan-a');
  assert(reconciledPlanA && reconciledPlanA.id === 'local-plan-a' && reconciledPlanA.customer === 'Frontend Multi Plan Customer' && reconciledPlanA.amount === 239 && reconciledPlanA.cloverPaymentSource === 'frontend-provider-source-a', 'The reconciled roster must keep WheelsonAuto operating fields while retaining provider-only card evidence for the exact subscription.');
  assert(context.uniqueRecurringMoneyRows([providerMirror, localPlanA, localPlanB]).length === 2, 'Money totals must deduplicate an exact provider/local subscription mirror while counting two distinct plans for the same customer.');
  context.db.recurringPayments = originalRecurringRows;
  context.db.integrations.clover.recurringPlanMembers = originalCloverMembers;
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
  assert(context.telnyxCampaignDraftAvailable({ carrierBrandVerified: true, carrierUsecaseQualified: true, carrierCampaignStatus: 'Not found', carrierResubmissionBlocked: false }) === true, 'A verified and qualified corrected Telnyx campaign must expose the owner review action.');
  assert(context.telnyxCampaignDraftAvailable({ carrierBrandVerified: true, carrierUsecaseQualified: true, carrierCampaignStatus: 'ACTIVE', carrierActiveCampaignAvailable: true }) === false, 'An existing active Telnyx campaign must hide the paid duplicate-submission action.');
  const telnyxCampaignReview = context.telnyxCampaignDraftReview({
    draft: {
      fingerprint: 'telnyx-review-fingerprint',
      reviewFeeUsd: 15,
      recurringMonthlyFeeUsd: 10,
      confirmationPhrase: 'SUBMIT TELNYX CUSTOMER_CARE $15 + $10/MONTH',
      warning: 'Preview only. No fee has been charged.',
      payload: { usecase: 'CUSTOMER_CARE', description: 'Customer care only.', messageFlow: 'Unchecked consent box and customer-initiated messages.', sample1: 'Payment reminder sample.', sample2: 'Service reminder sample.', webhookURL: 'https://wheelsonauto-platform.onrender.com/api/webhooks/messages?provider=telnyx' }
    },
    readiness: { brandStatus: 'VERIFIED' },
    submission: { status: 'not_started', retryBlocked: false }
  });
  assert(telnyxCampaignReview.includes('$15.00 review fee + $10.00/month') && telnyxCampaignReview.includes('telnyxCampaignFeeAcknowledged') && telnyxCampaignReview.includes('SUBMIT TELNYX CUSTOMER_CARE $15 + $10/MONTH') && telnyxCampaignReview.includes('Submit corrected campaign') && telnyxCampaignReview.includes('it does not enable texting'), 'The owner campaign modal must show exact dynamic fees, consent proof, the exact phrase gate, and the carrier-review warning before submission.');
  const stripeActivationReview = context.stripeAccountReadinessReview({ configured: true, keyMode: 'test', checkedKeyMode: 'test', detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, cardPaymentsCapability: 'pending', transfersCapability: 'inactive', accountRequirementsClear: false, currentlyDueCount: 2, pastDueCount: 1, pendingVerificationCount: 1, eventuallyDueCount: 2, successful: true, configurationMatched: true, fresh: true, checkedAt: '2026-07-20T12:00:00.000Z', live: false, error: 'Activate the Stripe business account and add its live secret key before checking account readiness.' }, { endpointMatched: false, active: false, exactEvents: false, enabledEventCount: 0, requiredEventCount: 21, configurationMatched: true, fresh: true, live: false, error: 'Deploy the Stripe live secret key before checking the webhook destination.' });
  assert(stripeActivationReview.includes('Stripe launch connection is not complete yet') && stripeActivationReview.includes('4 Stripe requirements still open') && stripeActivationReview.includes('2 future Stripe requirements') && stripeActivationReview.includes('Finish Stripe business onboarding') && stripeActivationReview.includes('Stripe has not enabled live charges') && stripeActivationReview.includes('Stripe has not enabled live payouts') && stripeActivationReview.includes('Card payments capability') && stripeActivationReview.includes('WheelsonAuto autopay') && stripeActivationReview.includes('Cards only - ACH and bank accounts are rejected') && stripeActivationReview.includes('Transfers capability') && stripeActivationReview.includes('Account requirements') && stripeActivationReview.includes('Webhook destination') && stripeActivationReview.includes('Webhook events') && stripeActivationReview.includes('0 / 21 exact required events') && stripeActivationReview.includes('Safe check only') && stripeActivationReview.includes('does not save a card, charge a customer, issue a refund, or change Clover') && stripeActivationReview.includes('Open Stripe webhooks') && stripeActivationReview.includes('Live launch preflight'), 'Stripe connection checking must open one compact owner handoff with account activation, card-only policy, exact webhook contract, due-item, and pending-verification gaps plus a clear no-money-action guarantee.');
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

  context.db.vehicles.unshift({
    id: 'veh-owner-resolver-reachability',
    year: 2025,
    make: 'Resolver',
    model: 'Reachability',
    vin: 'RESOLVERREACHVIN',
    plate: 'RES-OLVE',
    status: 'Rented',
    currentCustomer: 'Resolver Primary',
    assignmentConflict: 'Resolver Primary / Resolver Alias'
  });
  const assignmentResolverBoard = renderView(context, 'Operations', 'Assigned');
  assert(assignmentResolverBoard.includes('data-action="resolve-assignment-conflict"') && assignmentResolverBoard.includes('data-id="veh-owner-resolver-reachability"'), 'Operations / Assigned must render the owner conflict resolver after all fleet-card decorators are applied.');
  const launchAssignmentReview = context.liveLaunchPreflightModal({
    ok: false,
    missing: ['resolve active vehicle assignment conflicts'],
    database: { productionReady: true, snapshotRecoveryReady: true, migrationProofReady: true, schemaContractReady: true, schemaContract: { ready: true, missingMigrations: [], missingConstraints: [], missingIndexes: [] } },
    databaseCredentialIsolation: { ready: true, configured: false, message: 'Dedicated PostgreSQL drill credentials are isolated from the production web runtime.' },
    backendCutover: { ready: false, backend: 'json', error: 'WheelsonAuto is still using the JSON development backend.' },
    documentEncryptionKeys: { ready: true, encryptedDocuments: 4 },
    privateArtifacts: { ready: false, error: 'Backfill encrypted receipt and dispute artifacts.' },
    operationalAlerts: { live: true },
    stripeAccount: { provider: 'stripe', configured: true, keyMode: 'test', checkedKeyMode: 'test', detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, live: false, error: 'Activate the Stripe business account and add its live secret key before checking account readiness.' },
    stripeWebhook: { live: false, error: 'Complete one live WheelsonAuto Stripe event.' },
    stripeIdentityWebhook: { live: false, error: 'Complete one live license and selfie verification.' },
    telnyxMessaging: { provider: 'telnyx', brandStatus: 'VERIFIED', brandVerified: true, campaignStatus: 'TCR_FAILED', campaignActive: false, numberAssigned: false, carrierUsecaseQualified: true, carrierUsecaseQualificationUsecase: 'CUSTOMER_CARE', carrierUsecaseQualificationFees: { monthly: 10, quarterly: 30, annual: 120 }, live: false, error: 'Create and receive approval for the corrected campaign.' },
    resendEmail: { provider: 'resend', senderDomain: 'notify.wheelsonauto.com', senderDomainVerified: true, outboundVerified: true, inboundVerified: false, live: false, error: 'Send a reply into the signed Resend inbound webhook.' },
    starAi: { provider: 'openai', model: 'gpt-5.5', configured: true, operational: true, healthVerified: true, dailyRemaining: 47, monthlyRemaining: 490, autoSendEnabled: false, live: true, health: { checkedAt: new Date().toISOString() } },
    controlledStripePilot: { approved: false, readyForApproval: false, message: 'Complete one exact live pilot.' },
    controlledStripePilotSelection: {
      eligibleCount: 1,
      blockedCount: 1,
      message: '1 exact applicant and vehicle file is ready to open for controlled pilot review.',
      candidates: [
        { applicationId: 'app-pilot-ready', customer: 'Pilot Customer', vehicle: '2020 Pilot Ready', vin: 'PILOTREADYVIN0001', plate: 'PIL-001', weeklyPayment: 229, downPayment: 485, onboardingStatus: 'Not started', paymentProvider: 'stripe', identityProvider: 'stripe', eligible: true, action: 'prepare', blockers: [] },
        { applicationId: 'app-pilot-blocked', customer: 'Blocked Customer', vehicle: '2021 Pilot Blocked', weeklyPayment: 0, downPayment: 0, onboardingStatus: 'Not started', eligible: false, action: 'prepare', blockers: ['Vehicle VIN is missing.', 'Locked weekly payment is missing.'] }
      ]
    },
    assignmentConflicts: [
      { vehicleId: 'veh-owner-resolver-reachability', vehicle: '2025 Resolver Reachability', vin: 'RESOLVERREACHVIN', plate: 'RES-OLVE', claimedBy: 'Resolver Primary / Resolver Alias', sources: ['WheelsonAuto autopay', 'recurring_payment', 'Customer file', 'customer_file'] },
      { vehicleId: 'veh-owner-review-warning', vehicle: '2024 Resolver Review', vin: 'RESOLVERREVIEWVIN', plate: 'RES-WARN', claimedBy: 'Saved Customer / Imported Name', sources: ['Customer record'] }
    ],
    structuralAssignmentConflicts: [{ vehicleId: 'veh-owner-resolver-reachability', vehicle: '2025 Resolver Reachability', vin: 'RESOLVERREACHVIN', plate: 'RES-OLVE', claimedBy: 'Resolver Primary / Resolver Alias', sources: ['customer', 'customer_file'] }],
    assignmentReviewWarnings: [{ vehicleId: 'veh-owner-review-warning', vehicle: '2024 Resolver Review', vin: 'RESOLVERREVIEWVIN', plate: 'RES-WARN', claimedBy: 'Saved Customer / Imported Name' }]
  });
  assert(launchAssignmentReview.includes('Launch-critical provider evidence') && launchAssignmentReview.includes('Payments + Identity') && launchAssignmentReview.includes('TEST') && launchAssignmentReview.includes('1 / 3 launch-critical') && launchAssignmentReview.includes('Carrier SMS stays optional.') && !launchAssignmentReview.includes('SMS + 10DLC') && !launchAssignmentReview.includes('CUSTOMER_CARE draft ready') && launchAssignmentReview.includes('Autopay method') && launchAssignmentReview.includes('Cards only') && launchAssignmentReview.includes('notify.wheelsonauto.com') && launchAssignmentReview.includes('gpt-5.5') && launchAssignmentReview.includes('47 remaining') && launchAssignmentReview.includes('Launch safeguards') && launchAssignmentReview.includes('First live Stripe pilot') && launchAssignmentReview.includes('Database safety contract') && launchAssignmentReview.includes('webhook and money-action uniqueness') && launchAssignmentReview.includes('JSON retirement sentinel') && launchAssignmentReview.includes('Document decryption coverage') && launchAssignmentReview.includes('Receipt + dispute evidence') && launchAssignmentReview.includes('never sends a message, charges a card') && launchAssignmentReview.includes('Database credential isolation') && launchAssignmentReview.includes('Data conflicts') && launchAssignmentReview.includes('1 transactional / 1 review') && launchAssignmentReview.includes('Vehicle assignment review') && launchAssignmentReview.includes('PostgreSQL conflict') && launchAssignmentReview.includes('Owner review') && launchAssignmentReview.includes('RESOLVERREACHVIN') && launchAssignmentReview.includes('Resolver Primary / Resolver Alias') && launchAssignmentReview.includes('WheelsonAuto autopay + Customer file') && countOf(launchAssignmentReview,'WheelsonAuto autopay')===1 && launchAssignmentReview.includes('data-action="resolve-assignment-conflict" data-id="veh-owner-resolver-reachability"') && launchAssignmentReview.includes('data-view="Operations" data-tab="Assigned"'), 'Controlled Stripe preflight must show launch-critical provider truth, the card-only autopay policy, infrastructure gates, pilot gate, and every classified assignment blocker without duplicating provider actions or optional carrier SMS.');
  assert(launchAssignmentReview.includes('Activate the Stripe business account and add its live secret key') && launchAssignmentReview.includes('Complete one live WheelsonAuto Stripe event') && launchAssignmentReview.includes('Complete one live license and selfie verification') && launchAssignmentReview.includes('WheelsonAuto never accepts legal terms automatically'), 'The single Stripe provider card must expose every current payment and Identity blocker plus the owner-only legal handoff instead of hiding later work behind the first error.');
  assert(launchAssignmentReview.includes('Current owner alert delivery test is verified.'), 'A verified operational-alert gate must not tell the owner that another current test is still required.');
  assert(launchAssignmentReview.includes('1 transactional assignment conflict blocks PostgreSQL and Stripe cutover.'), 'The assignment blocker sentence must derive its singular count from the transactional conflict list.');
  assert(launchAssignmentReview.includes('1 review-only warning remains visible'), 'The assignment summary must derive its singular review-only count without presenting it as a blocker.');
  assert(launchAssignmentReview.includes('Choose Stripe pilot (1)') && launchAssignmentReview.includes('data-action="choose-stripe-pilot"'), 'A blocked first pilot must expose one compact owner-only chooser in the existing preflight instead of requiring an off-app customer guess.');
  const controlledDollarPreflight = context.liveLaunchPreflightModal({
    controlledStripePilot: { required: true, approved: false, readyForApproval: true, candidate: { sessionId: 'onboard-controlled-dollar', customer: 'Owner Controlled Pilot', vehicle: 'Stripe $1 Testing Car', vin: 'WBAXH5C57DDW16897', plate: 'PILOT-1', depositAmount: 1, firstWeekAmount: 1, totalCollected: 2, controlledTest: true, ready: true }, message: 'The controlled low-dollar live Stripe pilot completed the full customer workflow and is ready for owner approval.' },
    controlledStripePilotSelection: { eligibleCount: 1, candidates: [] }
  });
  assert(controlledDollarPreflight.includes('Review pilot') && controlledDollarPreflight.includes('data-action="review-stripe-pilot"') && !controlledDollarPreflight.includes('Complete $1 Stripe test') && !controlledDollarPreflight.includes('Choose Stripe pilot (1)'), 'A complete low-dollar file must use the same owner review gate as a real customer lifecycle.');
  const controlledDollarApproval = context.stripePilotApprovalModal({ getAttribute: function(name){ return { 'data-session-id':'onboard-controlled-dollar', 'data-customer':'Owner Controlled Pilot', 'data-vehicle':'Stripe $1 Testing Car', 'data-vin':'WBAXH5C57DDW16897', 'data-plate':'PILOT-1', 'data-deposit-amount':'1', 'data-first-week-amount':'1', 'data-total-collected':'2', 'data-controlled-test':'1' }[name] || ''; } });
  assert(controlledDollarApproval.includes('full real-customer workflow') && controlledDollarApproval.includes('completed vehicle pickup') && controlledDollarApproval.includes('active pickup-day autopay') && controlledDollarApproval.includes('test file can be deleted after owner review') && controlledDollarApproval.includes('data-action="approve-stripe-pilot"'), 'Controlled $1 approval must prove the normal handoff and autopay lifecycle instead of offering a shortcut.');
  const controlledDollarChoice = context.stripePilotChoiceCard({ applicationId: 'app-controlled-dollar', customer: 'Owner Controlled Pilot', vehicle: 'Stripe $1 Testing Car', vin: 'WBAXH5C57DDW16897', plate: 'PILOT-1', downPayment: 1, weeklyPayment: 1, onboardingStatus: 'Pickup complete', controlledTest: true, eligible: true, action: 'continue', blockers: [] });
  assert(controlledDollarChoice.includes('Controlled $1 test') && controlledDollarChoice.includes('full real customer, vehicle handoff, pickup, and autopay lifecycle') && controlledDollarChoice.includes('stays out of business revenue'), 'The pilot chooser must explain the controlled price and reporting treatment without weakening the customer lifecycle.');
  const pilotChooser = context.stripePilotSelectionModal({
    eligibleCount: 1,
    message: '1 exact applicant and vehicle file is ready to open for controlled pilot review.',
    candidates: [
      { applicationId: 'app-pilot-ready', customer: 'Pilot Customer', vehicle: '2020 Pilot Ready', vin: 'PILOTREADYVIN0001', plate: 'PIL-001', weeklyPayment: 229, downPayment: 485, onboardingStatus: 'Not started', paymentProvider: 'stripe', identityProvider: 'stripe', eligible: true, action: 'prepare', blockers: [] },
      { applicationId: 'app-pilot-blocked', customer: 'Blocked Customer', vehicle: '2021 Pilot Blocked', weeklyPayment: 0, downPayment: 0, onboardingStatus: 'Not started', eligible: false, action: 'prepare', blockers: ['Vehicle VIN is missing.', 'Locked weekly payment is missing.'] }
    ]
  });
  assert(pilotChooser.includes('Opening a file is read-only preparation.') && pilotChooser.includes('does not create onboarding, send a link, hold a vehicle, save a card, or charge money') && pilotChooser.includes('PILOTREADYVIN0001') && pilotChooser.includes('data-action="open-stripe-pilot-file"') && pilotChooser.includes('1 file needs review') && pilotChooser.includes('Vehicle VIN is missing.') && !pilotChooser.includes('data-application-id="app-pilot-blocked"'), 'The pilot chooser must show exact identity and prices, keep blocked files read-only, and explain that opening a file has no external side effect.');
  const pilotFileContext = makeContext({ name: 'Pilot Owner', username: 'owner', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  pilotFileContext.db.applications.unshift({ id: 'app-pilot-file', name: 'Pilot File Customer', email: 'pilot-file@example.com', onlineVehicleId: 'online-pilot-file', vehicle: '2020 Pilot File', pricingSnapshot: { weeklyPayment: 229, downPayment: 485 }, status: 'New', submittedAt: '2026-07-21T12:00:00.000Z' });
  pilotFileContext.db.onlineVehicles.unshift({ id: 'online-pilot-file', platformVehicleId: 'veh-pilot-file', title: '2020 Pilot File', vin: 'PILOTFILEVIN00001', plate: 'PIL-002', weeklyPayment: 229, downPayment: 485, published: true, availability: 'Available' });
  pilotFileContext.db.vehicles.unshift({ id: 'veh-pilot-file', year: 2020, make: 'Pilot', model: 'File', vin: 'PILOTFILEVIN00001', plate: 'PIL-002', status: 'Ready' });
  pilotFileContext.window.__woaSelectedPilotCandidate = { applicationId: 'app-pilot-file', paymentProvider: 'stripe', identityProvider: 'stripe' };
  pilotFileContext.openNativeApplication('app-pilot-file');
  const pilotFile = modalHtml(pilotFileContext);
  assert(pilotFile.includes('Application file') && pilotFile.includes('VIN PILOTFILEVIN00001 | Tag PIL-002 | Online online-pilot-file') && pilotFile.includes('$229/week') && pilotFile.includes('$485 nonrefundable down | Stripe card setup + Stripe Identity') && pilotFile.includes('Preparation only.') && pilotFile.includes('holds this exact vehicle for up to seven days') && pilotFile.includes('saves an unsent customer-message draft') && pilotFile.includes('does not send the message or charge the deposit or weekly payment'), 'The selected pilot file must retain exact VIN/tag, locked terms, configured providers, and every preparation side effect without adding another page or implying that money moves.');
  const detachedConflictButton = { dataset: { id: 'veh-detached-review', vehicleName: '2023 Detached Review', vin: 'DETACHEDVIN', plate: 'DET-123', tracker: 'Tracker 9', claimedBy: 'One Name / Two Name', jobErrorId: 'job-error-42' } };
  const detachedConflictVehicle = context.assignmentConflictVehicleFromButton(detachedConflictButton);
  assert(detachedConflictVehicle && detachedConflictVehicle.id === 'veh-detached-review' && detachedConflictVehicle.vin === 'DETACHEDVIN' && detachedConflictVehicle.assignmentConflict === 'One Name / Two Name' && detachedConflictVehicle.jobErrorId === 'job-error-42', 'A preflight review must retain enough safe vehicle and job-error identity to open the exact server resolver even when that vehicle is absent from the current client list.');
  const resolvedAssignmentNotice = context.resolvedAssignmentJobBody({ vehicle: { name: '2023 Detached Review', plate: 'DET-123' }, claims: [{ customer: 'Current Customer' }, { customer: 'Current Customer' }] }, detachedConflictVehicle);
  assert(resolvedAssignmentNotice.includes('No active assignment conflict remains.') && resolvedAssignmentNotice.includes('1 active customer identity (Current Customer)') && resolvedAssignmentNotice.includes('data-error-id="job-error-42"') && resolvedAssignmentNotice.includes('Mark old notice reviewed'), 'A stale assignment job failure must explain that the current state is clean and offer only an auditable notice closeout, not merge or transfer controls.');
  const multiIdentityResolver = context.assignmentConflictResolverBody({
    vehicle: { id: 'veh-multi-identity', name: '2025 Multi Identity', vin: 'MULTIIDENTITYVIN', conflict: 'Customer Name / PROVIDER123 / Old Spelling' },
    claims: [
      { customer: 'Customer Name', source: 'Customer file', status: 'Active' },
      { customer: 'PROVIDER123', source: 'Clover recurring', status: 'Active' },
      { customer: 'Old Spelling', source: 'WheelsonAuto autopay', status: 'Active' }
    ],
    aliases: [{ id: 'alias-multi-1', canonicalCustomer: 'Customer Name', aliasCustomer: 'PROVIDER123', aliases: ['Customer Name', 'PROVIDER123'] }],
    identities: [],
    sharedSignals: [],
    providerSummary: {}
  });
  assert(multiIdentityResolver.includes('<option value="Customer Name" selected>') && multiIdentityResolver.includes('class="assignment-alias-choice"') && multiIdentityResolver.includes('data-customer="PROVIDER123"') && multiIdentityResolver.includes('data-customer="Old Spelling"'), 'A multi-identity assignment review must show one primary customer and a checked-name list that can resolve all verified same-person references in one save.');
  assert(multiIdentityResolver.includes('Choose one primary name, check every other name/reference that belongs to that same person, and save once') && multiIdentityResolver.includes('Resolved name-link audit') && multiIdentityResolver.includes('Link checked names') && multiIdentityResolver.includes('not fully resolved until no separate identity group remains'), 'The assignment resolver must replace confusing pair-by-pair progress with one explicit checked-name save while retaining audit history and distinguishing partial progress from final resolution.');
  assert(multiIdentityResolver.includes('Names or references that belong to the current renter') && multiIdentityResolver.includes('assignment-transfer-keep') && multiIdentityResolver.includes('Every unchecked identity on this exact car moves to history'), 'The renter-transfer resolver must explicitly separate kept current-renter aliases from old renter identities.');
  const assignmentClaimActions = context.assignmentConflictEvidenceHtml({
    claims: [
      { id: 'file-exact-old-assignment', source: 'Customer file', customer: 'Old Assignment', status: 'Active' },
      { id: 'autopay-exact-current-assignment', source: 'WheelsonAuto autopay', customer: 'Current Assignment', status: 'Active', amount: 229, frequency: 'Weekly' },
      { id: 'clover-exact-plan', source: 'Clover recurring', customer: 'Clover Name Variant', status: 'Active' }
    ],
    identities: [],
    sharedSignals: [],
    providerSummary: {}
  });
  assert(assignmentClaimActions.includes('data-action="open-contract" data-id="file-exact-old-assignment"') && assignmentClaimActions.includes('data-action="open-autopay" data-id="autopay-exact-current-assignment"') && assignmentClaimActions.includes('data-view="Payments" data-tab="Active"') && assignmentClaimActions.includes('multiple payment plans can still belong to one person') && assignmentClaimActions.includes('never merges, stops, or charges a plan'), 'Owner assignment review must open each exact editable source, route Clover-only rows to Payments, and explain that same-customer links do not alter payment plans.');

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
    ['Website applications', 'Website', 'Applications', ['Website', 'Onboarding', 'Scheduled Pickup', 'History', 'native-applications-board'], false],
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
  const ownerSecurity = renderView(context, 'Settings', 'Security');
  assertHealthy('Owner password security', ownerSecurity, ['Owner login & security', 'Strong password saved', 'Password login verified', 'Password protected', '5 attempt lock', 'Account recovery', 'Log out', 'Access matrix']);
  assertNo('Owner Security cutover secret hygiene', ownerSecurity, ['passwordHash', 'passwordSalt', 'passwordLoginVerifiedFingerprint']);
  const ownerSetupContext = makeContext({ name: 'Owner Setup', username: 'owner', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access', ownerAccess: { passwordLoginConfigured: false, passwordLoginStrong: false, passwordLoginVerified: false, passwordSessionVerified: false, pinFallbackAllowed: true, canDisablePinFallback: false } });
  const ownerSetup = renderView(ownerSetupContext, 'Settings', 'Security');
  assertHealthy('Owner credential setup', ownerSetup, ['Owner login & security', 'Set username &amp; password', 'Password protected', '5 attempt lock', 'Account recovery']);
  const ownerClaimsOpen = renderView(context, 'Claims & Issues', 'Open');
  assertNo('Owner Claims duplicate boards', ownerClaimsOpen, ['Dispute identity resolver', 'Dispute evidence package', 'Dispute / recovery bridge']);
  const ownerPickups = renderView(context, 'Applications', 'Pickups');
  assertHealthy('Owner pickup schedule', ownerPickups, ['Applications', 'Pickup schedule', '5150 NJ-42', 'next-day minimum', 'integration-workspace']);
  context.db.applications.unshift(
    { id: 'app-sort-older', name: 'Older Application', status: 'New', stage: 'New', submittedAt: '2026-07-21T09:15:00.000Z' },
    { id: 'app-sort-newest', name: 'Newest Application', status: 'New', stage: 'New', submittedAt: '2026-07-22T16:45:00.000Z' }
  );
  const sortedApplications = renderView(context, 'Applications', 'Onboarding');
  assert(sortedApplications.indexOf('Newest Application') < sortedApplications.indexOf('Older Application'), 'Applications must render newest submission first.');
  assert(sortedApplications.includes('class="native-application-submitted"') && sortedApplications.includes('Submitted') && sortedApplications.includes('datetime="2026-07-22T16:45:00.000Z"'), 'Application cards must show the saved submission date and time without opening the file.');

  context.openComposeMessage('new');
  assertHealthy('Compose message modal', modalHtml(context), ['New message', 'Optional SMS', 'Email', 'Send message']);

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
    ['Manager applications', 'Applications', 'Onboarding', ['Applications', 'Onboarding', 'native-applications-board'], false],
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

function cloverPartialRosterSmoke() {
  const context = makeContext({ name: 'Owner Clover Review', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  const review = context.liveLaunchCloverQuarantineReview({
    providerCoverageGapRows: 47,
    lastCompleteRosterSubscriptionIds: 55,
    lastCompleteRosterAt: '2026-07-20T12:30:00.000Z',
    lastCompleteRosterConfigurationMatched: true,
    quarantine: []
  });
  assertHealthy('Partial Clover roster review', review, ['Partial Clover response - 47 saved subscription rows are waiting', 'last complete 55-subscription snapshot', 'retained for audit only; it does not authorize a cutover', 'No separate customer-identity or duplicate-plan conflict is actionable']);
  assert(!/Customer identity missing|clover_subscription_not_in_verified_roster/.test(review), 'A provider-wide partial roster must not render dozens of omitted subscriptions as customer-assignment conflicts.');
  const completeCountReview = context.liveLaunchCloverQuarantineReview({
    providerCoverageGapRows: 4,
    providerRosterCountComplete: true,
    providerSubscriptionRows: 55,
    quarantine: []
  });
  ['Saved Clover review - 4 local rows are not in the current 55-subscription provider roster', 'Clover returned its full active subscription count', 'Another identical sync will not supply a missing subscription ID'].forEach(text => {
    assert(completeCountReview.includes(text), 'Complete-count Clover saved-row review is missing: ' + text);
  });
  assert(!completeCountReview.includes('Partial Clover response'), 'A complete provider count with retained local history must not tell the owner to repeat the same Clover sync.');
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

function sessionExpirySmoke() {
  const context = makeContext({ name: 'Owner Session', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  context.localStorage.setItem('woa-platform-backup', JSON.stringify(seed));
  context.document.getElementById('root').innerHTML = '<div>Private customer and payment data</div>';
  context.__woaHandleAuthenticatedResponse({ status: 401, ok: false }, '/api/system/infrastructure/preflight');
  const locked = html(context);
  assert(context.window.location.href === '/login?expired=1', 'An expired staff API session must return to login immediately.');
  assert(context.localStorage.getItem('woa-platform-backup') === null, 'An expired session must clear the browser emergency state backup.');
  assert(!/Private customer and payment data/.test(locked) && /Session expired/.test(locked), 'An expired session must blank stale business data before navigation.');
  assert((context.db.customers || []).length === 0 && (context.db.payments || []).length === 0, 'An expired session must clear in-memory customer and payment state.');

  const forbidden = makeContext({ name: 'Manager Session', role: 'Manager', homeView: 'Manager Portal', access: 'Manager access' });
  forbidden.__woaHandleAuthenticatedResponse({ status: 403, ok: false }, '/api/system/infrastructure/preflight');
  assert(forbidden.window.location.href === '/', 'A role-based 403 must not be mistaken for an expired authentication session.');
}

function starAutoSendDefaultSmoke() {
  const context = makeContext({ name: 'Owner Star Safety', role: 'Owner', homeView: 'Dashboard', access: 'Owner access' });
  context.db.integrations = context.db.integrations || {};
  context.db.integrations.messaging = {};
  const missing = context.messagingStatus();
  assert(missing.enabled === false && missing.aiEnabled === false && missing.aiAutoSend === false && missing.aiDrafts === false && missing.emailEnabled === false && missing.notificationsEnabled === false, 'Messaging providers, notifications, and Star must remain off when no saved server setting exists.');
  Object.assign(context.db.integrations.messaging, { enabled: true, aiEnabled: true, aiAutoSend: true, aiDrafts: true, emailEnabled: true, notificationsEnabled: true });
  const explicit = context.messagingStatus();
  assert(explicit.enabled === true && explicit.aiEnabled === true && explicit.aiAutoSend === true && explicit.aiDrafts === true && explicit.emailEnabled === true && explicit.notificationsEnabled === true, 'Messaging providers, notifications, and Star may turn on only after explicit saved settings.');
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
  cloverPartialRosterSmoke();
  await refreshCoordinationSmoke();
  sessionExpirySmoke();
  starAutoSendDefaultSmoke();
  heavyMessagesReportsSmoke();
  console.log('Frontend render smoke passed: owner, manager, mechanic, public, recovery console, heavy Messages/Reports, key tabs, role scrub, click interactions, search, and core modals render without localhost.');
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
