const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SEED_FILE = path.join(ROOT, 'seed.json');
const PORT = Number(process.env.PORT || 4181);
const HOST = process.env.HOST || '0.0.0.0';
const LOGIN_PIN = process.env.WOA_ADMIN_PIN || '';
const SESSION_VALUE = process.env.WOA_SESSION || ('woa-' + crypto.randomBytes(12).toString('hex'));
const CLOVER_TOKEN = process.env.CLOVER_ACCESS_TOKEN || '';
const CLOVER_MERCHANT_ID = process.env.CLOVER_MERCHANT_ID || '';
const CLOVER_ENV = process.env.CLOVER_ENV || 'production';
const CLOVER_API_BASE = CLOVER_ENV === 'sandbox' ? 'https://sandbox.dev.clover.com' : 'https://api.clover.com';
const CLOVER_HCO_BASE = CLOVER_ENV === 'sandbox' ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com';
const CLOVER_ECOMMERCE_PRIVATE_KEY = process.env.CLOVER_ECOMMERCE_PRIVATE_KEY || '';
const CLOVER_HCO_PAGE_CONFIG_UUID = process.env.CLOVER_HCO_PAGE_CONFIG_UUID || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://wheelsonauto-platform.onrender.com').replace(/\/+$/, '');

async function readData() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const seed = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
      await writeData(seed);
      return seed;
    } catch {
      return { vehicles: [], applications: [], customers: [], contracts: [], payments: [], maintenance: [], recurringPayments: [], integrations: { clover: {}, shopify: {} } };
    }
  }
}
async function writeData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = DATA_FILE + '.tmp';
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpFile, DATA_FILE);
}
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) { res.writeHead(status, { 'Content-Type': type, ...extra }); res.end(body); }
function json(res, status, payload) { send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8'); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => { const i = part.indexOf('='); return [part.slice(0, i).trim(), part.slice(i + 1).trim()]; })); }
function authed(req) { return cookies(req).woa_session === SESSION_VALUE; }
async function readBody(req) { let body = ''; for await (const chunk of req) body += chunk; return body; }
function escapeHtml(value) { return String(value || '').replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c])); }
function loginPage(message = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Login</title><link rel="stylesheet" href="/styles.css"></head><body><main class="login-page"><form class="login-card" method="POST" action="/login"><a class="login-logo-link" href="https://www.wheelsonauto.com/"><img class="login-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"></a><div class="eyebrow">Secure access</div><h1>WheelsonAuto Portal</h1><p>Authorized staff only. Please sign in to continue.</p>' + (message ? '<p class="err">' + escapeHtml(message) + '</p>' : '') + '<label>Access PIN<input name="pin" type="password" autofocus></label><button>Sign in</button></form></main></body></html>';
}
async function appHtml({ publicMode = false } = {}) {
  const data = await readData();
  const clientData = publicMode ? {
    vehicles: (data.vehicles || []).filter(v => ['Ready', 'Coming soon', 'Pending application'].includes(v.status)),
    business: data.business || { name: 'WheelsonAuto', website: 'wheelsonauto.com' },
    applications: [],
    customers: [],
    contracts: [],
    payments: [],
    maintenance: [],
    recurringPayments: [],
    tasks: [],
    documents: [],
    websiteLeads: [],
    integrations: { clover: {}, shopify: { store: 'wheelsonauto.com', embedPath: '/apply' } }
  } : data;
  let html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const inject = '<script>window.__SERVER_DATA__=' + JSON.stringify(clientData).replace(/</g, '\\u003c') + ';window.__PUBLIC_MODE__=' + (publicMode ? 'true' : 'false') + ';</script>';
  return html.replace('</head>', inject + '</head>');
}
async function staticFile(res, pathname) {
  const clean = pathname.replace(/^\//, '');
  if (!['styles.css', 'app.js'].includes(clean)) return false;
  const type = clean.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
  send(res, 200, await fs.readFile(path.join(ROOT, clean), 'utf8'), type);
  return true;
}
function scoreApplication(app) {
  let score = 45;
  if (Number(app.income) >= 2500) score += 20;
  if (Number(app.income) >= 4000) score += 10;
  if (Number(app.down) >= 1000) score += 15;
  if (Number(app.down) >= 2000) score += 10;
  return Math.min(98, score);
}
function cloverReady() {
  if (!CLOVER_TOKEN || !CLOVER_MERCHANT_ID) throw new Error('Clover is not connected yet. Add CLOVER_ACCESS_TOKEN and CLOVER_MERCHANT_ID in Render.');
}
function cloverCheckoutReady() {
  if (!CLOVER_ECOMMERCE_PRIVATE_KEY || !CLOVER_MERCHANT_ID) throw new Error('Clover Hosted Checkout is not ready. Add CLOVER_ECOMMERCE_PRIVATE_KEY and CLOVER_MERCHANT_ID in Render. The key must be the Ecommerce private key for Hosted Checkout.');
}
function checkoutStatus() {
  return {
    ok: !!(CLOVER_ECOMMERCE_PRIVATE_KEY && CLOVER_MERCHANT_ID),
    environment: CLOVER_ENV,
    merchantId: CLOVER_MERCHANT_ID ? 'stored in Render' : '',
    ecommercePrivateKey: CLOVER_ECOMMERCE_PRIVATE_KEY ? 'stored in Render' : '',
    pageConfigUuid: CLOVER_HCO_PAGE_CONFIG_UUID ? 'stored in Render' : '',
    publicBaseUrl: PUBLIC_BASE_URL,
    message: CLOVER_ECOMMERCE_PRIVATE_KEY && CLOVER_MERCHANT_ID ? 'Hosted Checkout is ready to create Clover payment sessions.' : 'Add CLOVER_ECOMMERCE_PRIVATE_KEY and CLOVER_MERCHANT_ID in Render.'
  };
}
async function cloverGet(pathname) {
  cloverReady();
  const response = await fetch(CLOVER_API_BASE + pathname, { headers: { Authorization: 'Bearer ' + CLOVER_TOKEN, Accept: 'application/json' } });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error('Clover API ' + response.status + ': ' + (body.message || body.error || text || 'Request failed'));
  return body;
}
async function cloverPostCheckout(payload) {
  cloverCheckoutReady();
  const response = await fetch(CLOVER_HCO_BASE + '/invoicingcheckoutservice/v1/checkouts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + CLOVER_ECOMMERCE_PRIVATE_KEY,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Clover-Merchant-Id': CLOVER_MERCHANT_ID
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error('Clover Hosted Checkout ' + response.status + ': ' + (body.message || body.error || text || 'Request failed'));
  if (!body.href) throw new Error('Clover Hosted Checkout did not return a checkout URL.');
  return body;
}
function cloverElements(body) { return Array.isArray(body.elements) ? body.elements : []; }
function firstElement(value) { return value && Array.isArray(value.elements) && value.elements[0] ? value.elements[0] : {}; }
function mapCloverCustomer(customer) {
  const first = customer.firstName || '';
  const last = customer.lastName || '';
  const name = (first + ' ' + last).trim() || customer.name || customer.id;
  return {
    id: 'clover-customer-' + customer.id,
    cloverCustomerId: customer.id,
    name,
    phone: firstElement(customer.phoneNumbers).phoneNumber || '',
    email: firstElement(customer.emailAddresses).emailAddress || '',
    contract: 'Clover customer',
    balance: 0,
    source: 'Clover',
    updatedAt: new Date().toISOString()
  };
}
function mapCloverPayment(payment) {
  const amount = Number(payment.amount || 0) / 100;
  const created = payment.createdTime ? new Date(payment.createdTime).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US');
  const customer = payment.employee && payment.employee.name ? payment.employee.name : 'Clover payment';
  return {
    id: 'clover-payment-' + payment.id,
    cloverPaymentId: payment.id,
    date: created,
    customer,
    method: payment.tender && payment.tender.label ? payment.tender.label : 'Clover',
    amount,
    status: payment.result === 'SUCCESS' ? 'Paid' : (payment.result || 'Recorded'),
    source: 'Clover',
    tone: payment.result === 'SUCCESS' ? 'good' : 'warn'
  };
}
function upsertById(list, incoming) {
  const next = Array.isArray(list) ? list.slice() : [];
  incoming.forEach(item => {
    const index = next.findIndex(existing => existing.id === item.id);
    if (index >= 0) next[index] = { ...next[index], ...item };
    else next.unshift(item);
  });
  return next;
}
async function syncCloverIntoData(data, options = {}) {
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  const result = { customers: 0, payments: 0, errors: [] };
  if (options.customers !== false) {
    try {
      const body = await cloverGet('/v3/merchants/' + CLOVER_MERCHANT_ID + '/customers?expand=emailAddresses,phoneNumbers&limit=100');
      const customers = cloverElements(body).map(mapCloverCustomer);
      data.customers = upsertById(data.customers, customers);
      data.integrations.clover.lastCustomerSyncAt = new Date().toISOString();
      data.integrations.clover.lastCustomerSyncCount = customers.length;
      result.customers = customers.length;
    } catch (err) {
      data.integrations.clover.lastCustomerSyncError = String(err && err.message || err);
      result.errors.push(data.integrations.clover.lastCustomerSyncError);
    }
  }
  if (options.payments !== false) {
    try {
      const body = await cloverGet('/v3/merchants/' + CLOVER_MERCHANT_ID + '/payments?limit=100');
      const payments = cloverElements(body).map(mapCloverPayment);
      data.payments = upsertById(data.payments, payments);
      data.integrations.clover.lastPaymentSyncAt = new Date().toISOString();
      data.integrations.clover.lastPaymentSyncCount = payments.length;
      data.integrations.clover.lastPaymentSyncError = '';
      result.payments = payments.length;
    } catch (err) {
      data.integrations.clover.lastPaymentSyncError = String(err && err.message || err);
      result.errors.push(data.integrations.clover.lastPaymentSyncError);
    }
  }
  data.integrations.clover.connected = result.errors.length === 0 || data.integrations.clover.connected === true;
  data.integrations.clover.environment = CLOVER_ENV;
  data.integrations.clover.merchantId = CLOVER_MERCHANT_ID;
  data.integrations.clover.accessTokenMasked = 'stored in Render';
  return result;
}
function cleanAutopayPayload(payload) {
  const amount = Number(payload.amount || 0);
  return {
    id: payload.id || ('rec-' + Date.now()),
    customer: String(payload.customer || '').trim(),
    phone: String(payload.phone || '').trim(),
    email: String(payload.email || '').trim(),
    vehicle: String(payload.vehicle || '').trim(),
    amount: Number.isFinite(amount) ? amount : 0,
    frequency: payload.frequency || 'Weekly',
    nextRun: payload.nextRun || payload.firstRun || 'After setup',
    status: payload.status || 'Setup needed',
    tone: payload.tone || (payload.status === 'Active' ? 'good' : 'warn'),
    provider: 'Clover',
    cloverCustomerId: String(payload.cloverCustomerId || '').trim(),
    cloverSubscriptionId: String(payload.cloverSubscriptionId || '').trim(),
    paymentSetup: payload.paymentSetup || 'Needs Clover setup',
    notes: String(payload.notes || '').trim(),
    createdAt: payload.createdAt || new Date().toISOString()
  };
}
function cents(amount) { return Math.max(0, Math.round(Number(amount || 0) * 100)); }
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || 'WheelsonAuto', lastName: parts.slice(1).join(' ') || 'Customer' };
}
function publicPayHtml(request, message = '') {
  const safeName = escapeHtml(request.customer || 'Customer');
  const amount = '$' + Number(request.amount || 0).toLocaleString();
  const vehicle = escapeHtml(request.vehicle || 'WheelsonAuto recurring payment');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Payment</title><link rel="stylesheet" href="/styles.css"></head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure Clover payment</div></div></a></div><h1>Complete your WheelsonAuto payment</h1><p>This payment opens on Clover secure checkout. WheelsonAuto never stores your card or bank details.</p></div><main class="public-main"><section class="card section"><div class="grid two"><div class="item"><strong>Customer</strong><div>' + safeName + '</div><div class="muted">' + vehicle + '</div></div><div class="item"><strong>Amount due</strong><div class="money">' + amount + '</div><div class="muted">' + escapeHtml(request.frequency || 'Recurring payment') + '</div></div></div>' + (message ? '<div class="notice" style="margin-top:12px">' + escapeHtml(message) + '</div>' : '') + '<form method="POST" action="/api/public/payment-links/' + encodeURIComponent(request.id) + '/checkout" style="margin-top:14px"><button class="btn primary" type="submit">Pay securely with Clover</button><a class="btn" href="https://www.wheelsonauto.com/">Back to WheelsonAuto</a></form></section></main></div></body></html>';
}
function paymentResultHtml(title, message) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Payment</title><link rel="stylesheet" href="/styles.css"></head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure Clover payment</div></div></a></div><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p></div><main class="public-main"><section class="card section"><a class="btn primary" href="https://www.wheelsonauto.com/">Back to WheelsonAuto</a></section></main></div></body></html>';
}
function createPaymentRequest(data, payload) {
  const recurring = (data.recurringPayments || []).find(p => p.id === payload.recurringPaymentId) || {};
  const amount = Number(payload.amount || recurring.amount || 0);
  const request = {
    id: 'plink-' + crypto.randomBytes(12).toString('hex'),
    recurringPaymentId: payload.recurringPaymentId || recurring.id || '',
    customer: payload.customer || recurring.customer || '',
    phone: payload.phone || recurring.phone || '',
    email: payload.email || recurring.email || '',
    vehicle: payload.vehicle || recurring.vehicle || '',
    amount,
    frequency: payload.frequency || recurring.frequency || 'Weekly',
    status: 'Open',
    source: 'WheelsonAuto hosted checkout',
    createdAt: new Date().toISOString(),
    url: ''
  };
  request.url = PUBLIC_BASE_URL + '/pay/' + request.id;
  return request;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
    if (await staticFile(res, url.pathname)) return;
    if (url.pathname === '/apply' && req.method === 'GET') return send(res, 200, await appHtml({ publicMode: true }));
    if (url.pathname.startsWith('/pay/') && req.method === 'GET') {
      const parts = url.pathname.split('/').filter(Boolean);
      const requestId = parts[1];
      const data = await readData();
      data.paymentRequests = Array.isArray(data.paymentRequests) ? data.paymentRequests : [];
      const request = data.paymentRequests.find(item => item.id === requestId);
      if (!request) return send(res, 404, paymentResultHtml('Payment link not found', 'Please contact WheelsonAuto so we can send a fresh payment link.'));
      if (parts[2] === 'success') {
        request.status = 'Paid through Clover checkout';
        request.paidAt = new Date().toISOString();
        data.payments = Array.isArray(data.payments) ? data.payments : [];
        if (!data.payments.some(payment => payment.paymentRequestId === request.id)) {
          data.payments.unshift({ id: 'pay-' + Date.now(), paymentRequestId: request.id, date: new Date().toLocaleString('en-US'), customer: request.customer, method: 'Clover Hosted Checkout', amount: request.amount, status: 'Paid', tone: 'good', source: 'Clover Hosted Checkout' });
        }
        const recurring = (data.recurringPayments || []).find(p => p.id === request.recurringPaymentId);
        if (recurring) { recurring.status = 'Active'; recurring.tone = 'good'; recurring.lastPaymentAt = new Date().toISOString(); }
        await writeData(data);
        return send(res, 200, paymentResultHtml('Payment received', 'Thank you. Clover has returned this payment as successful, and WheelsonAuto can now update your account.'));
      }
      if (parts[2] === 'failure') {
        request.status = 'Failed or incomplete';
        request.failedAt = new Date().toISOString();
        const recurring = (data.recurringPayments || []).find(p => p.id === request.recurringPaymentId);
        if (recurring) { recurring.status = 'Failed retry'; recurring.tone = 'bad'; }
        await writeData(data);
        return send(res, 200, publicPayHtml(request, 'That payment did not complete. You can try again below, or contact WheelsonAuto for help.'));
      }
      return send(res, 200, publicPayHtml(request));
    }
    if (url.pathname.startsWith('/api/public/payment-links/') && url.pathname.endsWith('/checkout') && req.method === 'POST') {
      const requestId = url.pathname.split('/')[4];
      const data = await readData();
      data.paymentRequests = Array.isArray(data.paymentRequests) ? data.paymentRequests : [];
      const request = data.paymentRequests.find(item => item.id === requestId);
      if (!request) return send(res, 404, paymentResultHtml('Payment link not found', 'Please contact WheelsonAuto so we can send a fresh payment link.'));
      const name = splitName(request.customer);
      const checkout = await cloverPostCheckout({
        ...(CLOVER_HCO_PAGE_CONFIG_UUID ? { pageConfigUuid: CLOVER_HCO_PAGE_CONFIG_UUID } : {}),
        customer: { email: request.email || undefined, firstName: name.firstName, lastName: name.lastName, phoneNumber: request.phone || undefined },
        redirectUrls: { success: PUBLIC_BASE_URL + '/pay/' + request.id + '/success', failure: PUBLIC_BASE_URL + '/pay/' + request.id + '/failure' },
        shoppingCart: { lineItems: [{ name: 'WheelsonAuto ' + (request.frequency || 'recurring') + ' payment', note: request.vehicle || 'Recurring payment', price: cents(request.amount), unitQty: 1 }] }
      });
      request.status = 'Clover checkout opened';
      request.checkoutSessionId = checkout.checkoutSessionId || '';
      request.checkoutHref = checkout.href;
      request.checkoutCreatedAt = new Date().toISOString();
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: checkout.href });
    }
    if (url.pathname === '/api/public/applications' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const app = { id: payload.id || ('app-' + Date.now()), submittedAt: payload.submittedAt || new Date().toISOString(), stage: 'New', status: 'New', score: payload.score || scoreApplication(payload), ...payload };
      data.applications = Array.isArray(data.applications) ? data.applications : [];
      data.websiteLeads = Array.isArray(data.websiteLeads) ? data.websiteLeads : [];
      if (!data.applications.some(existing => existing.id === app.id)) data.applications.unshift(app);
      if (!data.websiteLeads.some(existing => existing.applicationId === app.id)) data.websiteLeads.unshift({ id: 'lead-' + Date.now(), applicationId: app.id, source: 'wheelsonauto.com/apply', name: app.name, vehicle: app.vehicle, created: 'Just now', status: 'Submitted' });
      await writeData(data);
      return json(res, 201, { ok: true, application: app });
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const pin = new URLSearchParams(await readBody(req)).get('pin');
      if (LOGIN_PIN && pin === LOGIN_PIN) return send(res, 302, '', 'text/plain', { 'Set-Cookie': 'woa_session=' + SESSION_VALUE + '; HttpOnly; SameSite=Lax; Path=/', Location: '/' });
      return send(res, 401, loginPage('That PIN did not match.'));
    }
    if (url.pathname === '/logout') return send(res, 302, '', 'text/plain', { 'Set-Cookie': 'woa_session=; Max-Age=0; Path=/', Location: '/' });
    if (!authed(req)) return send(res, 200, loginPage());
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, await readData());
    if (url.pathname === '/api/state' && req.method === 'PUT') { await writeData(JSON.parse(await readBody(req) || '{}')); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/reset' && req.method === 'POST') { await fs.copyFile(SEED_FILE, DATA_FILE); return json(res, 200, { ok: true, data: await readData() }); }
    if (url.pathname === '/api/integrations/clover/connect' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.integrations = data.integrations || {}; data.integrations.clover = { ...(data.integrations.clover || {}), ...payload, connected: true };
      await writeData(data); return json(res, 200, { ok: true, clover: data.integrations.clover });
    }
    if (url.pathname === '/api/integrations/clover/checkout-status' && req.method === 'POST') {
      return json(res, 200, checkoutStatus());
    }
    if (url.pathname === '/api/integrations/clover/sync-customers' && req.method === 'POST') {
      const data = await readData();
      const synced = await syncCloverIntoData(data, { payments: false });
      await writeData(data);
      return json(res, synced.errors.length ? 500 : 200, { ok: synced.errors.length === 0, imported: synced.customers, customers: data.customers.length, error: synced.errors[0] || '' });
    }
    if (url.pathname === '/api/integrations/clover/sync-payments' && req.method === 'POST') {
      const data = await readData();
      const synced = await syncCloverIntoData(data, { customers: false });
      await writeData(data);
      return json(res, synced.errors.length ? 500 : 200, { ok: synced.errors.length === 0, imported: synced.payments, recurring: data.recurringPayments.length, payments: data.payments.length, error: synced.errors[0] || '' });
    }
    if (url.pathname === '/api/integrations/clover/sync-all' && req.method === 'POST') {
      const data = await readData();
      const synced = await syncCloverIntoData(data);
      await writeData(data);
      return json(res, synced.errors.length ? 207 : 200, { ok: synced.errors.length === 0, ...synced, totalCustomers: (data.customers || []).length, totalPayments: (data.payments || []).length });
    }
    if (url.pathname === '/api/recurring-payments' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const autopay = cleanAutopayPayload(payload);
      data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
      data.customers = Array.isArray(data.customers) ? data.customers : [];
      data.recurringPayments.unshift(autopay);
      if (autopay.customer && !data.customers.some(c => String(c.name || '').toLowerCase() === autopay.customer.toLowerCase())) {
        data.customers.unshift({ id: 'cus-' + Date.now(), name: autopay.customer, phone: autopay.phone, email: autopay.email, contract: 'Autopay setup', balance: 0, source: 'WheelsonAuto', cloverCustomerId: autopay.cloverCustomerId });
      }
      await writeData(data);
      return json(res, 201, { ok: true, autopay });
    }
    if (url.pathname === '/api/payment-links' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.paymentRequests = Array.isArray(data.paymentRequests) ? data.paymentRequests : [];
      const request = createPaymentRequest(data, payload);
      data.paymentRequests.unshift(request);
      const recurring = (data.recurringPayments || []).find(p => p.id === request.recurringPaymentId);
      if (recurring) {
        recurring.lastPaymentLinkAt = new Date().toISOString();
        recurring.lastPaymentLinkUrl = request.url;
      }
      await writeData(data);
      return json(res, 201, { ok: true, paymentLink: request });
    }
    if (url.pathname === '/api/webhooks/clover' && req.method === 'POST') {
      const event = JSON.parse(await readBody(req) || '{}');
      const data = await readData(); data.integrations.clover.webhookEvents = data.integrations.clover.webhookEvents || []; data.integrations.clover.webhookEvents.unshift({ receivedAt: new Date().toISOString(), event }); await writeData(data); return json(res, 200, { ok: true });
    }
    return send(res, 200, await appHtml({ publicMode: false }));
  } catch (err) {
    send(res, 500, 'Server error: ' + String(err && err.message || err), 'text/plain; charset=utf-8');
  }
});
server.listen(PORT, HOST, () => console.log('WheelsonAuto platform running on ' + HOST + ':' + PORT));
