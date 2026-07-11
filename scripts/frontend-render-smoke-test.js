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
    addEventListener(type, handler) {
      this.eventHandlers[type] = this.eventHandlers[type] || [];
      this.eventHandlers[type].push(handler);
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

function ownerSmoke() {
  const context = makeContext({ name: 'Owner Smoke', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  assertHealthy('Owner dashboard', html(context), ['Dashboard', 'Today&rsquo;s dues & contact', 'Service due', 'Transactions', 'quickbar']);

  [
    ['Payments active', 'Payments', 'Active', ['Payments & Customers', 'Active recurring customers', 'Payment actions']],
    ['Payments today', 'Payments', 'Today', ['Daily closeout', 'Today action list']],
    ['Payments history', 'Payments', 'History', ['Customer history']],
    ['Payments transactions', 'Payments', 'Transactions', ['Transactions']],
    ['Operations fleet', 'Operations', 'Fleet', ['Operations', 'Available fleet']],
    ['Operations service', 'Operations', 'Service', ['Service work']],
    ['Operations claims', 'Operations', 'Claims', ['Claims, tolls & issues']],
    ['Messages Star', 'Messages', 'Star', ['Messages', 'Star AI', 'Auto-ready replies', 'Needs admin approval']],
    ['Settings', 'Settings', undefined, ['Settings']],
    ['Website', 'Website', undefined, ['Website']],
    ['Reports', 'Reports', undefined, ['Reports', 'Daily closeout']]
  ].forEach(([label, view, tab, required]) => assertHealthy(label, renderView(context, view, tab), required));

  context.openComposeMessage('new');
  assertHealthy('Compose message modal', modalHtml(context), ['New message', 'Text message', 'Email', 'Send / save message']);

  context.openGlobalSearch();
  assertHealthy('Global search modal', modalHtml(context), ['Search everything', 'Search customer, VIN, tag, tracker', 'Result']);
}

function managerSmoke() {
  const context = makeContext({ name: 'Manager Smoke', role: 'Manager', homeView: 'Manager Portal', access: 'Manager access' });
  assertHealthy('Manager portal', html(context), ['Manager Portal', 'Overview', 'Today manager queue']);

  [
    ['Manager operations', 'Operations', 'Service', ['Operations', 'Service work']],
    ['Manager messages', 'Messages', 'Inbox', ['Messages', 'Customer conversations', 'New text/email']],
    ['Manager reports', 'Reports', undefined, ['Reports', 'Executive snapshot']],
    ['Manager applications', 'Applications', 'Active', ['Applications']]
  ].forEach(([label, view, tab, required]) => {
    const output = renderView(context, view, tab);
    assertHealthy(label, output, required);
    assertNo(label, output, ['data-action="record-charge"', 'data-action="new-autopay"', 'data-action="save-clover"', 'data-view="Settings"']);
  });
}

function mechanicSmoke() {
  const context = makeContext({ name: 'Mechanic Smoke', role: 'Mechanic', homeView: 'Mechanic Portal', access: 'Mechanic access' });
  assertHealthy('Mechanic portal', html(context), ['Mechanic Portal', 'Priority work']);
  assertNo('Mechanic portal', html(context), ['data-view="Messages"', 'data-view="Payments"', 'data-action="compose-message"', 'data-action="record-charge"']);

  [
    ['Mechanic maintenance', 'Maintenance', 'Open', ['Maintenance', 'Open service work']],
    ['Mechanic fleet', 'Fleet', 'Available', ['Fleet', 'Available fleet']],
    ['Mechanic claims', 'Claims & Issues', 'Open', ['Claims & Issues', 'Open claims, tolls & issues']]
  ].forEach(([label, view, tab, required]) => {
    const output = renderView(context, view, tab);
    assertHealthy(label, output, required);
    assertNo(label, output, ['data-view="Messages"', 'data-view="Payments"', 'data-action="compose-message"', 'data-action="record-charge"', 'data-action="send-pay-link"']);
  });

  const blocked = renderView(context, 'Messages', 'Inbox');
  assertHealthy('Mechanic blocked Messages redirect', blocked, ['Mechanic Portal']);
  assertNo('Mechanic blocked Messages redirect', blocked, ['Customer conversations', 'New text/email']);
}

function publicSmoke() {
  const context = makeContext(null, true);
  assertHealthy('Public apply', html(context), ['Apply', 'WheelsonAuto', 'public']);
}

ownerSmoke();
managerSmoke();
mechanicSmoke();
publicSmoke();

console.log('Frontend render smoke passed: owner, manager, mechanic, public, key tabs, role scrub, and core modals render without localhost.');
