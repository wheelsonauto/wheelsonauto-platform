const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SEED_FILE = path.join(ROOT, 'seed.json');
const VEHICLE_IMPORT_FILE = path.join(ROOT, 'vehicle-import.json');
const PORT = Number(process.env.PORT || 4181);
const HOST = process.env.HOST || '0.0.0.0';
const LOGIN_PIN = process.env.WOA_ADMIN_PIN || '';
const SESSION_VALUE = process.env.WOA_SESSION || ('woa-' + crypto.randomBytes(12).toString('hex'));
const CLOVER_TOKEN = process.env.CLOVER_ACCESS_TOKEN || '';
const CLOVER_MERCHANT_ID = process.env.CLOVER_MERCHANT_ID || '';
const CLOVER_ENV = process.env.CLOVER_ENV || 'production';
const CLOVER_API_BASE = CLOVER_ENV === 'sandbox' ? 'https://sandbox.dev.clover.com' : 'https://api.clover.com';
const CLOVER_HCO_BASE = CLOVER_ENV === 'sandbox' ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com';
const CLOVER_CHARGE_BASE = process.env.CLOVER_CHARGE_BASE || (CLOVER_ENV === 'sandbox' ? 'https://scl-sandbox.dev.clover.com' : 'https://scl.clover.com');
const CLOVER_TOKEN_BASE = process.env.CLOVER_TOKEN_BASE || (CLOVER_ENV === 'sandbox' ? 'https://token-sandbox.dev.clover.com' : 'https://token.clover.com');
const CLOVER_ECOMMERCE_PRIVATE_KEY = process.env.CLOVER_ECOMMERCE_PRIVATE_KEY || '';
const CLOVER_ECOMMERCE_PUBLIC_KEY = process.env.CLOVER_ECOMMERCE_PUBLIC_KEY || process.env.CLOVER_API_ACCESS_KEY || '';
const CLOVER_HCO_PAGE_CONFIG_UUID = process.env.CLOVER_HCO_PAGE_CONFIG_UUID || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://wheelsonauto-platform.onrender.com').replace(/\/+$/, '');
const BROWSER_ICON_LINKS = '<link rel="icon" href="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=64"><link rel="apple-touch-icon" href="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180">';
const AUTO_SYNC_MS = Math.max(30000, Number(process.env.WOA_AUTO_SYNC_MS || 60000));
const AUTO_SYNC_STARTUP_DELAY_MS = Math.max(5000, Number(process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS || 15000));
const WOA_AUTOPAY_MS = Math.max(60000, Number(process.env.WOA_AUTOPAY_MS || 300000));
const autoSyncStatus = {
  enabled: true,
  intervalMs: AUTO_SYNC_MS,
  inFlight: false,
  lastStartedAt: '',
  lastFinishedAt: '',
  lastSource: '',
  lastError: '',
  lastResult: null
};
const woaAutopayStatus = {
  enabled: true,
  intervalMs: WOA_AUTOPAY_MS,
  inFlight: false,
  lastStartedAt: '',
  lastFinishedAt: '',
  lastError: '',
  lastResult: null
};

async function readData() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const seed = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
      await writeData(seed);
      return seed;
    } catch {
      return { vehicles: [], applications: [], customers: [], contracts: [], payments: [], maintenance: [], claims: [], messages: [], messageTemplates: [], staffAccounts: [], organizations: [], recurringPayments: [], tasks: [], documents: [], websiteLeads: [], apiProviders: [], integrations: { clover: {}, shopify: {} } };
    }
  }
}
async function writeData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = DATA_FILE + '.tmp';
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpFile, DATA_FILE);
}
function normKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function moneyNumber(value) {
  const cleaned = String(value || '').replace(/[$,\s]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}
function vehicleNameFromImport(row) {
  return [row.year, row.makeModel].filter(Boolean).join(' ').trim() || 'Imported vehicle';
}
function importVehicleStatus(row) {
  const status = String(row.status || '').toLowerCase();
  if (status.includes('rented')) return 'Rented';
  if (status.includes('lot')) return 'Ready';
  return row.customer ? 'Rented' : 'Ready';
}
function dateKey(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function importedOilDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/-/g, '/');
  const parts = normalized.split('/');
  if (parts.length >= 2) {
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    const year = Number(parts[2] || new Date().getFullYear());
    if (month && day) return dateKey(new Date(year, month - 1, day));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : dateKey(parsed);
}
function addMonths(dateText, months) {
  const base = dateText ? new Date(dateText + 'T12:00:00') : new Date();
  if (Number.isNaN(base.getTime())) return dateKey();
  base.setMonth(base.getMonth() + months);
  return dateKey(base);
}
function previousDayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}
function isInLotImport(row) {
  const status = String(row.status || '').toLowerCase().replace(/\s+/g, '');
  return status.includes('inlot') || status.includes('lot') || status.includes('ready') || (!row.customer && !status.includes('rented'));
}
function upsertMaintenanceJob(data, job) {
  data.maintenance = Array.isArray(data.maintenance) ? data.maintenance : [];
  const existing = data.maintenance.find(item => item.id === job.id);
  if (existing) {
    const status = String(existing.status || '').toLowerCase();
    if (status.includes('complete') || status.includes('fixed')) return false;
    Object.assign(existing, job);
    return false;
  }
  data.maintenance.unshift(job);
  return true;
}
function removeSheetMaintenanceForRow(data, rowNumber) {
  data.maintenance = Array.isArray(data.maintenance) ? data.maintenance : [];
  const ids = new Set([
    'mnt-sheet-oil-done-' + rowNumber,
    'mnt-sheet-oil-next-' + rowNumber,
    'mnt-sheet-oil-overdue-' + rowNumber
  ]);
  const before = data.maintenance.length;
  data.maintenance = data.maintenance.filter(item => !ids.has(item.id));
  return before - data.maintenance.length;
}
async function loadVehicleImport() {
  try {
    const body = JSON.parse(await fs.readFile(VEHICLE_IMPORT_FILE, 'utf8'));
    return Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return [];
  }
}
async function mergeVehicleImport(data) {
  const rows = await loadVehicleImport();
  if (!rows.length) return { rows: 0, vehicles: 0, customers: 0, contracts: 0, recurringLinked: 0 };
  data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  data.contracts = Array.isArray(data.contracts) ? data.contracts : [];
  data.maintenance = Array.isArray(data.maintenance) ? data.maintenance : [];
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  data.integrations.clover.recurringPlanMembers = Array.isArray(data.integrations.clover.recurringPlanMembers) ? data.integrations.clover.recurringPlanMembers : [];

  const vehicleIndex = new Map();
  data.vehicles.forEach((vehicle, index) => [vehicle.vin, vehicle.plate, vehicle.stock].filter(Boolean).forEach(key => vehicleIndex.set(normKey(key), index)));
  const customerIndex = new Map();
  data.customers.forEach((customer, index) => customerIndex.set(normKey(customer.name), index));
  const contractIndex = new Map();
  data.contracts.forEach((contract, index) => contractIndex.set(normKey(contract.customer) + '|' + normKey(contract.vehicle), index));
  const recurringRows = [...data.recurringPayments, ...data.integrations.clover.recurringPlanMembers];
  let customers = 0, contracts = 0, recurringLinked = 0, maintenanceImported = 0;

  rows.forEach(row => {
    const vehicleName = vehicleNameFromImport(row);
    const status = importVehicleStatus(row);
    const weekly = moneyNumber(row.weeklyAmount || row.weeklyAmountRaw);
    const plate = row.licensePlate || row.tempTag || '';
    const vehiclePatch = {
      name: vehicleName,
      year: row.year || '',
      make: String(row.makeModel || '').split(/\s+/)[0] || '',
      model: String(row.makeModel || '').split(/\s+/).slice(1).join(' '),
      vin: row.vin || '',
      plate,
      tempTag: row.tempTag || '',
      stock: plate || row.vin || ('CSV-' + row.rowNumber),
      mileage: Number(row.mileageStart || 0),
      odometer: Number(row.mileageStart || 0),
      status,
      tone: status === 'Rented' ? 'good' : 'good',
      currentCustomer: row.customer || '',
      rate: weekly || 0,
      tracker: row.tracker || '',
      oilChangeDate: row.oilChangeDate || '',
      lastChargedToll: row.lastChargedToll || '',
      violationBill: row.violationBill || '',
      notes: row.notes || '',
      photoUrl: '',
      source: 'Vehicle sheet import',
      sourceRow: row.rowNumber
    };
    const vehicleKey = [row.vin, row.licensePlate, row.tempTag].filter(Boolean).map(normKey).find(key => vehicleIndex.has(key));
    if (vehicleKey) {
      const existingVehicle = data.vehicles[vehicleIndex.get(vehicleKey)];
      if (existingVehicle.manuallyEditedAt) {
        Object.assign(existingVehicle, {
          source: existingVehicle.source || vehiclePatch.source,
          sourceRow: existingVehicle.sourceRow || vehiclePatch.sourceRow,
          sheetStatus: vehiclePatch.status,
          sheetCustomer: row.customer || '',
          sheetWeeklyAmount: weekly || 0,
          sheetTempTag: row.tempTag || '',
          sheetTracker: row.tracker || ''
        });
      } else {
        Object.assign(existingVehicle, vehiclePatch);
      }
    }
    else {
      data.vehicles.push({ id: 'veh-sheet-' + String(row.rowNumber).padStart(3, '0'), ...vehiclePatch });
      [row.vin, row.licensePlate, row.tempTag].filter(Boolean).forEach(key => vehicleIndex.set(normKey(key), data.vehicles.length - 1));
    }
    const currentVehicleKey = [row.vin, row.licensePlate, row.tempTag].filter(Boolean).map(normKey).find(key => vehicleIndex.has(key));
    const currentVehicle = currentVehicleKey ? data.vehicles[vehicleIndex.get(currentVehicleKey)] : null;
    const oilDone = importedOilDate(row.oilChangeDate);
    const outOfLot = status === 'Rented' && !isInLotImport(row);
    if (!outOfLot) {
      maintenanceImported += removeSheetMaintenanceForRow(data, row.rowNumber);
    } else if (oilDone) {
      if (upsertMaintenanceJob(data, {
        id: 'mnt-sheet-oil-done-' + row.rowNumber,
        vehicleId: currentVehicle && currentVehicle.id || '',
        vehicle: vehicleName,
        customer: row.customer || '',
        type: 'Monthly inspection / oil change',
        issue: 'Oil change completed',
        cost: 0,
        due: oilDone,
        nextDue: oilDone,
        reminder: 'Imported from vehicle sheet',
        notes: 'Oil change date from vehicle sheet: ' + row.oilChangeDate,
        status: 'Completed',
        completedAt: oilDone,
        fixedAt: oilDone,
        source: 'Vehicle sheet import',
        sourceRow: row.rowNumber
      })) maintenanceImported += 1;
      if (upsertMaintenanceJob(data, {
        id: 'mnt-sheet-oil-next-' + row.rowNumber,
        vehicleId: currentVehicle && currentVehicle.id || '',
        vehicle: vehicleName,
        customer: row.customer || '',
        type: 'Monthly inspection / oil change',
        issue: 'Next monthly oil change / inspection',
        cost: 0,
        due: addMonths(oilDone, 1),
        nextDue: addMonths(oilDone, 1),
        reminder: row.customer ? 'Remind customer when due' : 'Internal only',
        notes: 'Auto-created from the last oil change on the vehicle sheet.',
        status: 'Scheduled',
        source: 'Vehicle sheet import',
        sourceRow: row.rowNumber
      })) maintenanceImported += 1;
    } else if (outOfLot) {
      if (upsertMaintenanceJob(data, {
        id: 'mnt-sheet-oil-overdue-' + row.rowNumber,
        vehicleId: currentVehicle && currentVehicle.id || '',
        vehicle: vehicleName,
        customer: row.customer || '',
        type: 'Monthly inspection / oil change',
        issue: 'Oil change date missing - verify service',
        cost: 0,
        due: previousDayKey(),
        nextDue: previousDayKey(),
        reminder: row.customer ? 'Remind customer when due' : 'Internal only',
        notes: 'No oil change date was listed on the vehicle sheet. Mark fixed after service or update the due date.',
        status: 'Scheduled',
        source: 'Vehicle sheet import',
        sourceRow: row.rowNumber
      })) maintenanceImported += 1;
    }

    if (!row.customer) return;
    const customerKey = normKey(row.customer);
    const customerPatch = {
      name: row.customer,
      stage: status === 'Rented' ? 'Active contract' : 'Vehicle history',
      tone: status === 'Rented' ? 'good' : 'warn',
      vehicle: vehicleName,
      balance: 0,
      contract: 'Vehicle sheet import',
      source: 'Vehicle sheet import',
      weeklyAmount: weekly || 0,
      dateStarted: row.dateStarted || '',
      tracker: row.tracker || '',
      licensePlate: row.licensePlate || '',
      vin: row.vin || '',
      importedVehicleRow: row.rowNumber
    };
    const recurringMatch = recurringRows.find(recurring => normKey(recurring.customer) === customerKey) || {};
    if (recurringMatch.phone && !customerPatch.phone) customerPatch.phone = recurringMatch.phone;
    if (recurringMatch.email && !customerPatch.email) customerPatch.email = recurringMatch.email;
    if (customerIndex.has(customerKey)) Object.assign(data.customers[customerIndex.get(customerKey)], customerPatch);
    else {
      data.customers.push({ id: 'cus-sheet-' + String(row.rowNumber).padStart(3, '0'), phone: recurringMatch.phone || '', email: recurringMatch.email || '', ...customerPatch });
      customerIndex.set(customerKey, data.customers.length - 1);
    }
    customers += 1;

    if (weekly) {
      const contractKey = customerKey + '|' + normKey(vehicleName);
      const contractPatch = { customer: row.customer, vehicle: vehicleName, weekly, status: 'Active', tone: 'good', dateStarted: row.dateStarted || '', nextDue: '', balance: 0, autopay: 'Clover recurring', paymentProvider: 'Clover', tracker: row.tracker || '', source: 'Vehicle sheet import' };
      if (contractIndex.has(contractKey)) Object.assign(data.contracts[contractIndex.get(contractKey)], contractPatch);
      else {
        data.contracts.push({ id: 'WOA-SHEET-' + String(row.rowNumber).padStart(3, '0'), paidWeeks: 0, totalWeeks: 82, ...contractPatch });
        contractIndex.set(contractKey, data.contracts.length - 1);
      }
      contracts += 1;
    }

    recurringRows.forEach(recurring => {
      if (normKey(recurring.customer) !== customerKey) return;
      recurring.vehicle = recurring.vehicle || vehicleName;
      recurring.amount = Number(recurring.amount || weekly || 0);
      recurring.weeklyAmount = weekly || recurring.amount || 0;
      recurring.vin = recurring.vin || row.vin || '';
      recurring.licensePlate = recurring.licensePlate || row.licensePlate || '';
      recurring.tracker = recurring.tracker || row.tracker || '';
      recurring.dateStarted = recurring.dateStarted || row.dateStarted || '';
      recurring.sourceVehicleRow = row.rowNumber;
      recurringLinked += 1;
    });
  });

  data.integrations.vehicleSheet = { source: 'Vehicles  - Sheet1 (1).csv', importedAt: new Date().toISOString(), rows: rows.length, vehicles: rows.length, customers, contracts, recurringLinked, maintenanceImported };
  return data.integrations.vehicleSheet;
}
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) { res.writeHead(status, { 'Content-Type': type, ...extra }); res.end(body); }
function json(res, status, payload) { send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8'); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => { const i = part.indexOf('='); return [part.slice(0, i).trim(), part.slice(i + 1).trim()]; })); }
function sessionCookie(user) {
  const payload = Buffer.from(JSON.stringify(user), 'utf8').toString('base64url');
  return SESSION_VALUE + '.' + payload;
}
function sessionUser(req) {
  const raw = cookies(req).woa_session || '';
  if (raw === SESSION_VALUE) return { id: 'owner', name: 'Owner admin', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' };
  if (!raw.startsWith(SESSION_VALUE + '.')) return null;
  try {
    const body = JSON.parse(Buffer.from(raw.slice(SESSION_VALUE.length + 1), 'base64url').toString('utf8'));
    return body && body.role ? body : null;
  } catch {
    return null;
  }
}
function authed(req) { return !!sessionUser(req); }
function roleHome(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'mechanic') return 'Mechanic Portal';
  if (r === 'manager') return 'Manager Portal';
  return 'Dashboard';
}
function roleAccess(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'mechanic') return 'Maintenance only';
  if (r === 'manager') return 'Fleet and customer operations';
  return 'Full platform access';
}
function companyNameById(data, organizationId) {
  const org = (data.organizations || []).find(item => item.id === organizationId);
  return org && org.name || 'WheelsonAuto';
}
function staffLoginUser(staff) {
  return { id: staff.id || ('staff-' + Date.now()), name: staff.name || staff.role || 'Staff', role: staff.role || 'Staff', homeView: staff.homeView || roleHome(staff.role), access: roleAccess(staff.role), organizationId: staff.organizationId || 'org-wheelsonauto', companyName: staff.companyName || 'WheelsonAuto' };
}
function findStaffByPin(data, pin) {
  const clean = String(pin || '').trim();
  if (!clean) return null;
  return (data.staffAccounts || []).find(staff => String(staff.status || 'Active').toLowerCase() !== 'disabled' && String(staff.pinHint || '').trim() === clean) || null;
}
function isOwnerUser(user) {
  return String(user && user.role || '').toLowerCase() === 'owner';
}
function apiAllowedForUser(user, pathname) {
  if (isOwnerUser(user)) return true;
  const role = String(user && user.role || '').toLowerCase();
  const ownerOnly = ['/api/integrations', '/api/sync', '/api/import', '/api/woa-autopay', '/api/api-providers'];
  if (ownerOnly.some(prefix => pathname.startsWith(prefix))) return false;
  if ((role === 'mechanic' || role === 'manager') && ['/api/payment-links', '/api/recurring-payments'].some(prefix => pathname.startsWith(prefix))) return false;
  return true;
}
function stateForUserWrite(current, incoming, user) {
  if (isOwnerUser(user)) return incoming;
  const role = String(user && user.role || '').toLowerCase();
  const allowed = role === 'mechanic'
    ? ['maintenance', 'messages', 'vehicles']
    : role === 'manager'
      ? ['vehicles', 'applications', 'customers', 'contracts', 'maintenance', 'claims', 'messages', 'tasks', 'documents', 'websiteLeads']
      : ['messages'];
  const next = { ...current };
  allowed.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) next[key] = incoming[key];
  });
  next.lastStaffSaveAt = new Date().toISOString();
  next.lastStaffSaveBy = user && (user.name || user.role) || 'Staff';
  return next;
}
async function readBody(req) { let body = ''; for await (const chunk of req) body += chunk; return body; }
function escapeHtml(value) { return String(value || '').replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c])); }
function loginPage(message = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Login</title>' + BROWSER_ICON_LINKS + '<link rel="stylesheet" href="/styles.css"></head><body><main class="login-page"><form class="login-card" method="POST" action="/login"><a class="login-logo-link" href="https://www.wheelsonauto.com/"><img class="login-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"></a><div class="eyebrow">Secure access</div><h1>WheelsonAuto Portal</h1><p>Owner, manager, and mechanic accounts each open the right workspace.</p>' + (message ? '<p class="err">' + escapeHtml(message) + '</p>' : '') + '<label>Access PIN<input name="pin" type="password" autofocus autocomplete="current-password"></label><button>Sign in</button><div class="login-pin">Use the owner PIN for full access, or a staff temporary PIN saved under Settings.</div></form></main></body></html>';
}
async function appHtml({ publicMode = false, user = null } = {}) {
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
  const currentUser = publicMode ? null : (user || { id: 'owner', name: 'Owner admin', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' });
  const inject = '<script>window.__SERVER_DATA__=' + JSON.stringify(clientData).replace(/</g, '\\u003c') + ';window.__PUBLIC_MODE__=' + (publicMode ? 'true' : 'false') + ';window.__CURRENT_USER__=' + JSON.stringify(currentUser).replace(/</g, '\\u003c') + ';</script>';
  return html.replace('</head>', inject + '</head>');
}
async function staticFile(res, pathname) {
  const clean = pathname.replace(/^\//, '');
  if (!['styles.css', 'app.js', 'card-setup.js', 'ifleet-prototype.html'].includes(clean)) return false;
  const type = clean.endsWith('.css') ? 'text/css; charset=utf-8' : (clean.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8');
  send(res, 200, await fs.readFile(path.join(ROOT, clean), 'utf8'), type, { 'Cache-Control': 'no-store' });
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
function cloverChargeReady() {
  if (!CLOVER_ECOMMERCE_PRIVATE_KEY) throw new Error('Clover saved-card charging is not ready. Add CLOVER_ECOMMERCE_PRIVATE_KEY in Render.');
}
function cloverEcommerceAuthHeaders(mode) {
  const token = CLOVER_ECOMMERCE_PRIVATE_KEY;
  if (mode === 'basic-colon') return { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64') };
  if (mode === 'basic') return { Authorization: 'Basic ' + Buffer.from(token).toString('base64') };
  if (mode === 'api-key') return { apikey: token, apiKey: token };
  return { Authorization: 'Bearer ' + token };
}
async function cloverEcommerceFetch(pathname, options = {}) {
  cloverChargeReady();
  const modes = ['bearer', 'basic-colon', 'basic', 'api-key'];
  let last = null;
  for (const mode of modes) {
    const response = await fetch(CLOVER_CHARGE_BASE + pathname, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...cloverEcommerceAuthHeaders(mode)
      }
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    const result = { response, text, body, authMode: mode };
    last = result;
    if (response.status !== 401 && response.status !== 403) return result;
  }
  return last;
}
function checkoutStatus() {
  return {
    ok: !!(CLOVER_ECOMMERCE_PRIVATE_KEY && CLOVER_MERCHANT_ID),
    environment: CLOVER_ENV,
    merchantId: CLOVER_MERCHANT_ID ? 'stored in Render' : '',
    ecommercePrivateKey: CLOVER_ECOMMERCE_PRIVATE_KEY ? 'stored in Render' : '',
    ecommercePublicKey: CLOVER_ECOMMERCE_PUBLIC_KEY ? 'stored in Render' : '',
    pageConfigUuid: CLOVER_HCO_PAGE_CONFIG_UUID ? 'stored in Render' : '',
    publicBaseUrl: PUBLIC_BASE_URL,
    message: CLOVER_ECOMMERCE_PRIVATE_KEY && CLOVER_MERCHANT_ID ? 'Hosted Checkout is ready to create Clover payment sessions.' : 'Add CLOVER_ECOMMERCE_PRIVATE_KEY and CLOVER_MERCHANT_ID in Render.'
  };
}
function systemReadiness(data) {
  const env = key => process.env[key] ? 'Set' : 'Missing';
  const route = (method, path, purpose, status = 'Ready') => ({ method, path, purpose, status });
  const envChecks = [
    ['CLOVER_ACCESS_TOKEN', env('CLOVER_ACCESS_TOKEN'), 'Clover customer/payment/recurring sync'],
    ['CLOVER_MERCHANT_ID', env('CLOVER_MERCHANT_ID'), 'Clover merchant account'],
    ['CLOVER_ECOMMERCE_PUBLIC_KEY', env('CLOVER_ECOMMERCE_PUBLIC_KEY') === 'Set' || env('CLOVER_API_ACCESS_KEY') === 'Set' ? 'Set' : 'Missing', 'Clover card setup public key'],
    ['CLOVER_ECOMMERCE_PRIVATE_KEY', env('CLOVER_ECOMMERCE_PRIVATE_KEY'), 'Clover saved-card charges and card-on-file setup'],
    ['PUBLIC_BASE_URL', PUBLIC_BASE_URL ? 'Set' : 'Missing', 'Customer payment/card setup links'],
    ['WOA_AUTOPAY_MS', process.env.WOA_AUTOPAY_MS ? 'Set' : 'Default', 'WheelsonAuto autopay monitor interval']
  ];
  const routes = [
    route('GET', '/api/state', 'Dashboard state'),
    route('PUT', '/api/state', 'Role-aware dashboard saves'),
    route('POST', '/api/api-providers', 'API readiness setup records'),
    route('POST', '/api/tasks', 'Dispatch task creation'),
    route('POST', '/api/card-setup-requests', 'Customer card-on-file setup links'),
    route('POST', '/api/payment-links', 'Customer payment links'),
    route('POST', '/api/integrations/clover/manual-charge', 'Saved-card manual charges'),
    route('POST', '/api/integrations/clover/sync-all', 'Clover full sync'),
    route('POST', '/api/woa-autopay/run', 'WheelsonAuto autopay monitor'),
    route('POST', '/api/webhooks/clover', 'Clover webhook intake')
  ];
  const missing = envChecks.filter(item => item[1] === 'Missing').map(item => item[0]);
  const records = {
    vehicles: (data.vehicles || []).length,
    customers: (data.customers || []).length,
    contracts: (data.contracts || []).length,
    recurringPayments: (data.recurringPayments || []).length,
    apiProviders: (data.apiProviders || []).length,
    tasks: (data.tasks || []).length,
    documents: (data.documents || []).length
  };
  return {
    ok: missing.length === 0,
    checkedAt: new Date().toISOString(),
    environment: CLOVER_ENV,
    publicBaseUrl: PUBLIC_BASE_URL,
    missing,
    envChecks: envChecks.map(item => ({ key: item[0], status: item[1], purpose: item[2] })),
    routes,
    records,
    autoSync: autoSyncStatus,
    autopay: woaAutopayStatus
  };
}
async function cloverEcommerceDiagnostics() {
  const status = checkoutStatus();
  const result = {
    ...status,
    savedCardApi: {
      checked: false,
      authorized: false,
      status: 0,
      message: ''
    }
  };
  if (!CLOVER_ECOMMERCE_PRIVATE_KEY || !CLOVER_MERCHANT_ID) {
    result.savedCardApi.message = 'Missing Ecommerce private key or Clover merchant ID in Render.';
    return result;
  }
  const { response, text, body, authMode } = await cloverEcommerceFetch('/v1/customers', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'WheelsonAuto/1.0',
      'X-Clover-Merchant-Id': CLOVER_MERCHANT_ID
    },
    body: JSON.stringify({
      email: 'diagnostic-no-card@wheelsonauto.com',
      firstName: 'WheelsonAuto',
      lastName: 'Diagnostic',
      source: 'invalid-diagnostic-source'
    })
  });
  result.savedCardApi.checked = true;
  result.savedCardApi.status = response.status;
  result.savedCardApi.message = cloverErrorMessage(body, text);
  result.savedCardApi.authMode = authMode;
  result.savedCardApi.authorized = response.status !== 401 && response.status !== 403;
  if (result.savedCardApi.authorized) {
    result.savedCardApi.message = 'Ecommerce private key reached Clover saved-card API using ' + authMode + ' auth. A non-auth error here is expected because this check intentionally sends no real card.';
  }
  return result;
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
async function cloverPostCharge(payload, req) {
  cloverChargeReady();
  const forwardedFor = String(req && req.headers && req.headers['x-forwarded-for'] || req && req.socket && req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
  const { response, text, body } = await cloverEcommerceFetch('/v1/charges', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'WheelsonAuto/1.0',
      'X-Clover-Merchant-Id': CLOVER_MERCHANT_ID,
      'x-forwarded-for': forwardedFor,
      'idempotency-key': payload.idempotencyKey
    },
    body: JSON.stringify(payload.charge)
  });
  if (!response.ok) throw new Error('Clover saved-card charge ' + response.status + ': ' + cloverErrorMessage(body, text));
  return body;
}
async function cloverPostCardCustomer(payload) {
  cloverChargeReady();
  const { response, text, body } = await cloverEcommerceFetch('/v1/customers', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'WheelsonAuto/1.0',
      'X-Clover-Merchant-Id': CLOVER_MERCHANT_ID
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = cloverErrorMessage(body, text);
    if (response.status === 401 || response.status === 403) {
      throw new Error('Clover Ecommerce private key is unauthorized for saved-card setup. Replace CLOVER_ECOMMERCE_PRIVATE_KEY in Render with the private key from the Clover Ecommerce Hosted iFrame + API/SDK token, then redeploy. Clover said ' + response.status + ': ' + detail);
    }
    throw new Error('Clover card-on-file customer ' + response.status + ': ' + detail);
  }
  return body;
}
async function cloverPostRecurring(pathname, payload) {
  cloverReady();
  const response = await fetch(CLOVER_HCO_BASE + pathname, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + CLOVER_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'WheelsonAuto/1.0',
      'X-Clover-Merchant-Id': CLOVER_MERCHANT_ID
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error('Clover recurring API ' + response.status + ': ' + (body.message || body.error || text || 'Request failed'));
  return body;
}
function cloverErrorMessage(body, text) {
  const parts = [body && body.message, body && body.error, body && body.code, body && body.decline_code, body && body.param, body && body.type]
    .filter(Boolean)
    .map(value => typeof value === 'object' ? JSON.stringify(value) : String(value));
  const detail = parts.join(' | ');
  const raw = String(text || '').trim();
  if (raw && raw !== detail && raw.length <= 600) return detail ? detail + ' | ' + raw : raw;
  return detail || raw.slice(0, 600) || 'Request failed';
}
async function cloverGetRecurring(pathname) {
  cloverReady();
  const response = await fetch(CLOVER_API_BASE + pathname, {
    headers: {
      Authorization: 'Bearer ' + CLOVER_TOKEN,
      Accept: 'application/json',
      'X-Clover-Merchant-Id': CLOVER_MERCHANT_ID
    }
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error('Clover recurring API ' + response.status + ': ' + (body.message || body.error || text || 'Request failed'));
  return body;
}
function cloverElements(body) { return Array.isArray(body.elements) ? body.elements : []; }
function collectionElements(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.elements)) return body.elements;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.plans)) return body.plans;
  if (Array.isArray(body.subscriptions)) return body.subscriptions;
  return [];
}
function firstElement(value) {
  const items = collectionElements(value);
  return items[0] || {};
}
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
function cloverPersonName(source) {
  source = source || {};
  const first = source.firstName || source.givenName || '';
  const last = source.lastName || source.familyName || '';
  return (first + ' ' + last).trim() || source.name || source.fullName || source.customerName || source.companyName || '';
}
function cloverPaymentCustomerSource(payment) {
  payment = payment || {};
  const order = payment.order || {};
  return payment.customer || firstElement(payment.customers) || payment.customerInfo || order.customer || firstElement(order.customers) || {};
}
function cloverPaymentOrderId(payment) {
  const order = payment && payment.order || {};
  return String(order.id || payment && payment.orderId || payment && payment.cloverOrderId || '').trim();
}
function usefulPaymentName(value) {
  value = String(value || '').trim();
  if (!value || value.length < 2 || value.length > 80) return '';
  if (/^(clover|credit card|debit card|visa|mastercard|amex|discover|success|paid|fail|failed|manual|cash|other)$/i.test(value)) return '';
  if (/^\d+$/.test(value)) return '';
  return value;
}
function deepCloverPaymentName(value, path = '', depth = 0) {
  if (!value || depth > 4) return '';
  if (typeof value === 'string') {
    if (/(customer|cardholder|cardHolder|payer|buyer|billing).*name|name$/i.test(path) && !/(employee|merchant|device|tender|app|label|brand|type|state|result)/i.test(path)) return usefulPaymentName(value);
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepCloverPaymentName(item, path, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const nextPath = path ? path + '.' + key : key;
      if (/(employee|merchant|device|tender|app|label|brand|type|state|result)/i.test(nextPath)) continue;
      const found = deepCloverPaymentName(item, nextPath, depth + 1);
      if (found) return found;
    }
  }
  return '';
}
function cloverPaymentFallbackName(payment) {
  const tx = payment && payment.cardTransaction || {};
  const source = payment && payment.source || {};
  const direct = [
    payment && payment.cardholderName,
    payment && payment.cardHolderName,
    payment && payment.customerName,
    tx.cardholderName,
    tx.cardHolderName,
    tx.customerName,
    tx.cardholder,
    source.cardholderName,
    source.customerName
  ].map(usefulPaymentName).find(Boolean);
  return direct || deepCloverPaymentName(payment);
}
function mapCloverPayment(payment) {
  const amount = Number(payment.amount || 0) / 100;
  const created = payment.createdTime ? new Date(payment.createdTime).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US');
  const customerSource = cloverPaymentCustomerSource(payment);
  const customer = cloverPersonName(customerSource) || usefulPaymentName(payment.customerName) || usefulPaymentName(payment.externalCustomerReference) || cloverPaymentFallbackName(payment) || '';
  return {
    id: 'clover-payment-' + payment.id,
    cloverPaymentId: payment.id,
    cloverCustomerId: String(customerSource.id || payment.customerId || payment.cloverCustomerId || payment.externalCustomerReference || '').trim(),
    cloverOrderId: cloverPaymentOrderId(payment),
    employee: payment.employee && payment.employee.name ? payment.employee.name : '',
    date: created,
    customer: customer || 'Unmatched Clover payment',
    method: payment.tender && payment.tender.label ? payment.tender.label : 'Clover',
    amount,
    status: payment.result === 'SUCCESS' ? 'Paid' : (payment.result || 'Recorded'),
    source: 'Clover',
    tone: payment.result === 'SUCCESS' ? 'good' : 'warn'
  };
}
async function enrichCloverPayment(payment) {
  let enriched = payment || {};
  const hasName = !!cloverPersonName(cloverPaymentCustomerSource(enriched));
  if (!hasName && enriched.id) {
    try {
      const detail = await cloverGet('/v3/merchants/' + CLOVER_MERCHANT_ID + '/payments/' + encodeURIComponent(enriched.id) + '?expand=customer,customers,order,tender');
      enriched = { ...enriched, ...detail };
    } catch {}
  }
  if (!cloverPersonName(cloverPaymentCustomerSource(enriched))) {
    const orderId = cloverPaymentOrderId(enriched);
    if (orderId) {
      try {
        const order = await cloverGet('/v3/merchants/' + CLOVER_MERCHANT_ID + '/orders/' + encodeURIComponent(orderId) + '?expand=customers');
        enriched.order = { ...(enriched.order || {}), ...order };
      } catch {}
    }
  }
  return mapCloverPayment(enriched);
}
function upsertById(list, incoming) {
  const next = Array.isArray(list) ? list.slice() : [];
  incoming.forEach(item => {
    const index = next.findIndex(existing => existing.id === item.id);
    if (index >= 0) {
      const existing = next[index];
      const weakIncomingName = !item.customer || item.customer === 'Unmatched Clover payment' || item.customer === 'Clover payment';
      next[index] = { ...existing, ...item, customer: weakIncomingName && existing.customer ? existing.customer : item.customer };
    }
    else next.unshift(item);
  });
  return next;
}
function mergeById(preferred, fallback) {
  const merged = [];
  const seen = new Set();
  [...(Array.isArray(preferred) ? preferred : []), ...(Array.isArray(fallback) ? fallback : [])].forEach(item => {
    const id = item && item.id;
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    if (item) merged.push(item);
  });
  return merged;
}
async function protectConcurrentLocalWrites(data) {
  const latest = await readData();
  ['cardSetupRequests', 'paymentRequests', 'recurringPayments', 'tasks', 'apiProviders'].forEach(key => {
    data[key] = mergeById(latest[key], data[key]);
  });
  data.customers = upsertById(latest.customers, data.customers);
  data.payments = upsertById(latest.payments, data.payments);
  return data;
}
async function syncCloverIntoData(data, options = {}) {
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  const result = { customers: 0, payments: 0, recurringPlans: 0, errors: [] };
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
      let body;
      try {
        body = await cloverGet('/v3/merchants/' + CLOVER_MERCHANT_ID + '/payments?expand=customer,customers,order,tender&limit=100');
      } catch {
        body = await cloverGet('/v3/merchants/' + CLOVER_MERCHANT_ID + '/payments?limit=100');
      }
      const payments = [];
      for (const payment of cloverElements(body)) payments.push(await enrichCloverPayment(payment));
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
  if (options.recurring !== false) {
    try {
      const recurring = await syncCloverRecurringPlans(data);
      result.recurringPlans = recurring.recurringPlans;
    } catch (err) {
      data.integrations.clover.lastRecurringPlanSyncError = String(err && err.message || err);
      result.errors.push(data.integrations.clover.lastRecurringPlanSyncError);
    }
  }
  data.integrations.clover.connected = result.errors.length === 0 || data.integrations.clover.connected === true;
  data.integrations.clover.environment = CLOVER_ENV;
  data.integrations.clover.merchantId = CLOVER_MERCHANT_ID;
  data.integrations.clover.accessTokenMasked = 'stored in Render';
  return result;
}
async function runAutoSync(options = {}) {
  const now = Date.now();
  const lastStarted = autoSyncStatus.lastStartedAt ? Date.parse(autoSyncStatus.lastStartedAt) : 0;
  if (autoSyncStatus.inFlight) return { ok: false, skipped: true, reason: 'already running', status: autoSyncStatus };
  if (!options.force && lastStarted && now - lastStarted < AUTO_SYNC_MS) {
    return { ok: true, skipped: true, reason: 'waiting for next auto sync', status: autoSyncStatus };
  }
  autoSyncStatus.inFlight = true;
  autoSyncStatus.lastStartedAt = new Date().toISOString();
  autoSyncStatus.lastSource = options.source || 'automatic';
  autoSyncStatus.lastError = '';
  try {
    const data = await readData();
    data.integrations = data.integrations || {};
    data.integrations.autoSync = {
      enabled: true,
      intervalMs: AUTO_SYNC_MS,
      lastStartedAt: autoSyncStatus.lastStartedAt,
      lastSource: autoSyncStatus.lastSource
    };
    const result = await syncCloverIntoData(data);
    result.vehicleSheet = await mergeVehicleImport(data);
    autoSyncStatus.lastFinishedAt = new Date().toISOString();
    autoSyncStatus.lastResult = result;
    autoSyncStatus.lastError = result.errors[0] || '';
    data.integrations.autoSync.lastFinishedAt = autoSyncStatus.lastFinishedAt;
    data.integrations.autoSync.lastError = autoSyncStatus.lastError;
    data.integrations.autoSync.lastResult = result;
    await protectConcurrentLocalWrites(data);
    await writeData(data);
    return { ok: result.errors.length === 0, skipped: false, ...result, status: autoSyncStatus };
  } catch (err) {
    autoSyncStatus.lastFinishedAt = new Date().toISOString();
    autoSyncStatus.lastError = String(err && err.message || err);
    autoSyncStatus.lastResult = { errors: [autoSyncStatus.lastError] };
    try {
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.autoSync = {
        enabled: true,
        intervalMs: AUTO_SYNC_MS,
        lastStartedAt: autoSyncStatus.lastStartedAt,
        lastFinishedAt: autoSyncStatus.lastFinishedAt,
        lastSource: autoSyncStatus.lastSource,
        lastError: autoSyncStatus.lastError,
        lastResult: autoSyncStatus.lastResult
      };
      await protectConcurrentLocalWrites(data);
      await writeData(data);
    } catch {}
    return { ok: false, skipped: false, error: autoSyncStatus.lastError, status: autoSyncStatus };
  } finally {
    autoSyncStatus.inFlight = false;
  }
}
function cleanAutopayPayload(payload) {
  const amount = Number(payload.amount || 0);
  return {
    id: payload.id || ('rec-' + Date.now()),
    customer: String(payload.customer || '').trim(),
    phone: String(payload.phone || '').trim(),
    email: String(payload.email || '').trim(),
    vehicleId: String(payload.vehicleId || '').trim(),
    vehicle: String(payload.vehicle || '').trim(),
    vin: String(payload.vin || '').trim(),
    licensePlate: String(payload.licensePlate || payload.plate || '').trim(),
    plate: String(payload.plate || payload.licensePlate || '').trim(),
    tempTag: String(payload.tempTag || '').trim(),
    tracker: String(payload.tracker || '').trim(),
    amount: Number.isFinite(amount) ? amount : 0,
    frequency: payload.frequency || 'Weekly',
    nextRun: payload.nextRun || payload.firstRun || 'After setup',
    status: payload.status || 'Setup needed',
    tone: payload.tone || (payload.status === 'Active' ? 'good' : 'warn'),
    provider: 'Clover',
    cloverCustomerId: String(payload.cloverCustomerId || '').trim(),
    cloverSubscriptionId: String(payload.cloverSubscriptionId || '').trim(),
    cloverPaymentSource: String(payload.cloverPaymentSource || payload.paymentSource || payload.source || '').trim(),
    cardLabel: String(payload.cardLabel || '').trim(),
    cardLast4: String(payload.cardLast4 || '').trim(),
    paymentSetup: payload.paymentSetup || 'Needs Clover setup',
    notes: String(payload.notes || '').trim(),
    createdAt: payload.createdAt || new Date().toISOString()
  };
}
function cleanApiProviderPayload(payload) {
  const now = new Date().toISOString();
  return {
    id: String(payload.id || ('api-' + Date.now())).trim(),
    name: String(payload.name || payload.system || 'API system').trim(),
    group: String(payload.group || 'API').trim(),
    status: String(payload.status || 'API needed').trim(),
    owner: String(payload.owner || 'Owner').trim(),
    envKeys: String(payload.envKeys || payload.credentials || '').trim(),
    endpoint: String(payload.endpoint || payload.route || '').trim(),
    liveTest: String(payload.liveTest || payload.testPlan || '').trim(),
    notes: String(payload.notes || '').trim(),
    lastTestAt: String(payload.lastTestAt || '').trim(),
    lastTestResult: String(payload.lastTestResult || '').trim(),
    updatedAt: now,
    createdAt: payload.createdAt || now
  };
}
function cleanTaskPayload(payload) {
  const now = new Date().toISOString();
  return {
    id: String(payload.id || ('task-' + Date.now())).trim(),
    title: String(payload.title || payload.type || 'Task').trim(),
    type: String(payload.type || 'Other').trim(),
    customer: String(payload.customer || '').trim(),
    vehicle: String(payload.vehicle || '').trim(),
    due: String(payload.due || '').trim(),
    status: String(payload.status || 'Open').trim(),
    owner: String(payload.owner || '').trim(),
    notes: String(payload.notes || '').trim(),
    doneAt: String(payload.doneAt || '').trim(),
    updatedAt: now,
    createdAt: payload.createdAt || now
  };
}
function weeklyEquivalent(amount, frequency) {
  const value = Number(amount || 0);
  const f = String(frequency || '').toLowerCase();
  if (f.includes('bi-weekly')) return value / 2;
  if (f.includes('semi-month')) return value * 24 / 52;
  if (f === 'monthly') return value * 12 / 52;
  if (f.includes('bi-month')) return value * 6 / 52;
  if (f.includes('quarter')) return value * 4 / 52;
  if (f.includes('4 months')) return value * 3 / 52;
  if (f.includes('semi-annual')) return value * 2 / 52;
  if (f.includes('annual')) return value / 52;
  if (f.includes('daily')) return value * 7;
  return value;
}
function cleanCloverPlanSummary(plans) {
  return (Array.isArray(plans) ? plans : []).map((plan, index) => {
    const subtotal = Number(plan.subtotal || plan.amount || 0);
    const customers = Number(plan.customers || 0);
    const frequency = String(plan.frequency || 'Weekly').trim();
    const possibleWeekly = Number(plan.possibleWeekly != null ? plan.possibleWeekly : weeklyEquivalent(subtotal, frequency) * customers);
    return {
      id: String(plan.id || ('clover-plan-' + index + '-' + String(plan.plan || plan.name || subtotal).replace(/[^a-z0-9]+/gi, '-').toLowerCase())),
      plan: String(plan.plan || plan.name || subtotal || 'Clover plan').trim(),
      subtotal,
      customers,
      frequency,
      lastRun: String(plan.lastRun || '').trim(),
      status: String(plan.status || 'Active').trim(),
      possibleWeekly: Math.round(possibleWeekly * 100) / 100,
      source: 'Clover Plan Manager'
    };
  }).filter(plan => plan.plan && plan.status);
}
function summarizeCloverPlans(plans) {
  const summary = (plans || []).reduce((next, plan) => {
    if (String(plan.status || '').toLowerCase() === 'active') {
      next.activePlans += 1;
      next.activeCustomers += Number(plan.customers || 0);
      next.possibleWeekly += Number(plan.possibleWeekly != null ? plan.possibleWeekly : weeklyEquivalent(plan.subtotal, plan.frequency) * Number(plan.customers || 0));
    }
    return next;
  }, { activePlans: 0, activeCustomers: 0, possibleWeekly: 0 });
  summary.possibleWeekly = Math.round(summary.possibleWeekly * 100) / 100;
  return summary;
}
function amountFromRecurringValue(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value > 999 ? value / 100 : value;
  if (typeof value === 'string') return Number(value.replace(/[^0-9.]/g, '')) || 0;
  if (typeof value === 'object') {
    return amountFromRecurringValue(value.amount ?? value.value ?? value.total ?? value.price ?? value.unitAmount);
  }
  return 0;
}
function frequencyFromRecurringPlan(plan) {
  const raw = String(plan.frequency || plan.interval || plan.intervalUnit || plan.period || plan.billingCycle || plan.billingPeriod || '').toLowerCase();
  const count = Number(plan.intervalCount || plan.frequencyCount || plan.billingInterval || 1);
  if (raw.includes('week')) return count > 1 ? 'Bi-weekly' : 'Weekly';
  if (raw.includes('month')) return count > 1 ? (count + ' months') : 'Monthly';
  if (raw.includes('year') || raw.includes('annual')) return 'Annual';
  if (raw.includes('day')) return 'Daily';
  return plan.frequency || 'Weekly';
}
function activeSubscriptionCount(subscriptions) {
  return (subscriptions || []).filter(item => {
    const status = String(item.status || item.state || '').toLowerCase();
    return !status || !['canceled', 'cancelled', 'deleted', 'inactive', 'expired', 'failed', 'paused', 'suspended', 'void', 'disabled'].includes(status);
  }).length;
}
function nameFromRecurringSubscription(subscription) {
  const customer = subscription.customer || subscription.customerInfo || subscription.cardholder || subscription.cardHolder || {};
  const first = customer.firstName || subscription.firstName || '';
  const last = customer.lastName || subscription.lastName || '';
  return String(customer.name || subscription.customerName || subscription.name || ((first + ' ' + last).trim()) || '').trim();
}
function contactFromRecurringSubscription(subscription, key) {
  const customer = subscription.customer || subscription.customerInfo || {};
  const value = customer[key] || subscription[key] || '';
  if (value) return String(value);
  const plural = key === 'phone' ? 'phoneNumbers' : 'emailAddresses';
  const first = firstElement(customer[plural] || subscription[plural]);
  return String(first[key === 'phone' ? 'phoneNumber' : 'emailAddress'] || '');
}
function cleanPaymentSource(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const lowered = source.toLowerCase();
  if (['clover', 'clover recurring api', 'manual recurring roster import', 'clover plan manager', 'wheelsonauto hosted checkout'].includes(lowered)) return '';
  if (/\s/.test(source) || source.length < 8) return '';
  return source;
}
function isCloverEcommerceToken(value) {
  return /^clv_/i.test(String(value || '').trim());
}
function recurringCustomerSource(row) {
  const customer = row && (row.customer || row.customerInfo) || {};
  const candidates = [
    row && row.cloverCustomerId,
    row && row.customerId,
    customer && customer.id
  ];
  for (const value of candidates) {
    const source = cleanPaymentSource(value);
    if (source) return source;
  }
  return '';
}
function firstCardFromRecurring(row) {
  const customer = row && (row.customer || row.customerInfo) || {};
  const collections = [
    row && row.cards,
    row && row.card,
    row && row.paymentCards,
    row && row.paymentMethods,
    customer && customer.cards,
    customer && customer.paymentCards,
    customer && customer.paymentMethods
  ];
  for (const collection of collections) {
    if (!collection) continue;
    const cards = Array.isArray(collection) ? collection : collectionElements(collection);
    const card = cards.find(item => item && (item.id || item.token || item.source || item.paymentSource));
    if (card) return card;
    if (collection.id || collection.token || collection.source || collection.paymentSource) return collection;
  }
  return {};
}
function recurringPaymentSource(row) {
  const card = firstCardFromRecurring(row);
  const candidates = [
    row && row.cloverPaymentSource,
    row && row.paymentSource,
    row && row.paymentSourceId,
    row && row.token,
    row && row.paymentToken,
    row && row.multiPayToken,
    row && row.mtoken,
    row && row.cardToken,
    row && row.card && row.card.token,
    row && row.card && row.card.source,
    row && row.card && row.card.paymentSource,
    row && row.paymentMethod && row.paymentMethod.source,
    row && row.paymentMethod && row.paymentMethod.token,
    row && row.paymentMethod && row.paymentMethod.paymentSource,
    row && row.tender && row.tender.source,
    row && row.tender && row.tender.token,
    card && card.paymentSource,
    card && card.source,
    card && card.token,
    card && card.id
  ];
  for (const value of candidates) {
    const source = cleanPaymentSource(value);
    if (source) return source;
  }
  return '';
}
function recurringCardChargeSource(row) {
  const source = recurringPaymentSource(row);
  return isCloverEcommerceToken(source) ? source : '';
}
function hasWheelsonAutoSavedCard(row) {
  const setup = String(row && row.paymentSetup || '').toLowerCase();
  const source = String(row && row.source || '').toLowerCase();
  return !!(row && row.cardSavedAt) || setup.includes('card saved') || source.includes('wheelsonauto card setup');
}
function recurringCardLabel(row) {
  const card = firstCardFromRecurring(row);
  return String(row && row.cardLabel || row && row.cardBrand || row && row.brand || card.cardType || card.brand || card.label || '').trim();
}
function recurringCardLast4(row) {
  const card = firstCardFromRecurring(row);
  return String(row && row.cardLast4 || row && row.last4 || card.last4 || '').trim();
}
function membersFromRecurringSubscriptions(plan, subscriptions) {
  const subtotal = amountFromRecurringValue(plan.amount ?? plan.unitAmount ?? plan.price ?? plan.recurringAmount ?? plan.planAmount ?? plan.total);
  const frequency = frequencyFromRecurringPlan(plan);
  const planName = String(plan.name || plan.planName || plan.description || plan.id || '').trim();
  return (subscriptions || []).filter(item => activeSubscriptionCount([item]) > 0).map((item, index) => {
    const customer = item.customer || item.customerInfo || {};
    return {
      id: 'clover-recurring-member-' + (item.id || item.uuid || item.subscriptionId || (plan.id + '-' + index)),
      source: 'Clover recurring API',
      customer: nameFromRecurringSubscription(item) || 'Clover recurring customer',
      phone: contactFromRecurringSubscription(item, 'phone'),
      email: contactFromRecurringSubscription(item, 'email'),
      vehicle: String(item.vehicle || item.description || ''),
      plan: planName,
      amount: subtotal,
      frequency,
      status: String(item.status || item.state || 'Active'),
      nextRun: String(item.nextRun || item.nextRunDate || item.nextBillingDate || item.nextPaymentDate || ''),
      lastRun: String(item.lastRun || item.lastRunDate || item.lastPaymentDate || plan.lastRun || plan.lastRunDate || ''),
      cloverSubscriptionId: String(item.id || item.uuid || item.subscriptionId || ''),
      cloverCustomerId: String(customer.id || item.customerId || item.cloverCustomerId || ''),
      cloverPaymentSource: recurringPaymentSource(item),
      cardLabel: recurringCardLabel(item),
      cardLast4: recurringCardLast4(item)
    };
  });
}
function cleanRecurringRosterImport(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const amount = Number(row.amount ?? row.subtotal ?? row.weekly ?? row.payment ?? row.plan ?? 0);
    const plan = String(row.plan || row.name || row.amount || amount || '').trim();
    const customer = String(row.customer || row.name || row.customerName || row.fullName || '').trim();
    const phone = String(row.phone || row.phoneNumber || row.mobile || '').trim();
    const email = String(row.email || row.emailAddress || '').trim();
    return {
      id: String(row.id || row.cloverSubscriptionId || ('manual-recurring-member-' + Date.now() + '-' + index)),
      source: 'Manual recurring roster import',
      customer: customer || 'Clover recurring customer',
      phone,
      email,
      vehicle: String(row.vehicle || row.description || '').trim(),
      plan,
      amount: Number.isFinite(amount) ? amount : 0,
      frequency: String(row.frequency || 'Weekly').trim(),
      status: String(row.status || 'Active').trim(),
      nextRun: String(row.nextRun || row.nextRunDate || row.nextPaymentDate || '').trim(),
      lastRun: String(row.lastRun || row.lastRunDate || row.lastPaymentDate || '').trim(),
      cloverSubscriptionId: String(row.cloverSubscriptionId || row.subscriptionId || row.id || '').trim(),
      cloverCustomerId: String(row.cloverCustomerId || row.customerId || '').trim(),
      cloverPaymentSource: recurringPaymentSource(row),
      cardLabel: recurringCardLabel(row),
      cardLast4: recurringCardLast4(row)
    };
  }).filter(row => row.customer || row.phone || row.email || row.amount);
}
function mergeRecurringRoster(existing, imported) {
  const byKey = new Map();
  const keyFor = row => String(row.cloverSubscriptionId || row.id || ((row.customer || '').toLowerCase() + '|' + (row.phone || '') + '|' + (row.plan || row.amount || ''))).trim();
  (Array.isArray(existing) ? existing : []).forEach(row => byKey.set(keyFor(row), row));
  (Array.isArray(imported) ? imported : []).forEach(row => {
    const key = keyFor(row);
    const old = byKey.get(key) || {};
    byKey.set(key, { ...old, ...row, id: old.id || row.id });
  });
  return Array.from(byKey.values());
}
function enrichRecurringRoster(existing, imported) {
  const keyFor = row => String(row.cloverSubscriptionId || row.id || ((row.customer || '').toLowerCase() + '|' + (row.phone || '') + '|' + (row.plan || row.amount || ''))).trim();
  const importedByKey = new Map();
  (Array.isArray(imported) ? imported : []).forEach(row => importedByKey.set(keyFor(row), row));
  return (Array.isArray(existing) ? existing : []).map(row => {
    const incoming = importedByKey.get(keyFor(row)) || {};
    return {
      ...row,
      cloverPaymentSource: row.cloverPaymentSource || incoming.cloverPaymentSource || '',
      cardLabel: row.cardLabel || incoming.cardLabel || '',
      cardLast4: row.cardLast4 || incoming.cardLast4 || '',
      cloverCustomerId: row.cloverCustomerId || incoming.cloverCustomerId || '',
      cloverSubscriptionId: row.cloverSubscriptionId || incoming.cloverSubscriptionId || ''
    };
  });
}
function countFromRecurringPlan(plan) {
  const keys = [
    'activeCustomers', 'activeCustomerCount', 'customerCount', 'customersCount',
    'activeSubscriptions', 'activeSubscriptionCount', 'subscriptionCount',
    'subscriptionsCount', 'subscriberCount', 'subscribersCount',
    'totalSubscriptions', 'totalSubscribers', 'quantity'
  ];
  for (const key of keys) {
    const value = plan && plan[key];
    if (Array.isArray(value)) return value.length;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  for (const key of ['customers', 'subscriptions', 'subscribers']) {
    const value = plan && plan[key];
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      const collection = collectionElements(value);
      if (collection.length) return collection.length;
      const number = Number(value.count ?? value.total ?? value.totalCount ?? value.activeCount);
      if (Number.isFinite(number) && number >= 0) return number;
    }
  }
  return 0;
}
function cleanRecurringPlanFromApi(plan, subscriptions, index) {
  const subtotal = amountFromRecurringValue(plan.amount ?? plan.unitAmount ?? plan.price ?? plan.recurringAmount ?? plan.planAmount ?? plan.total);
  const frequency = frequencyFromRecurringPlan(plan);
  const subscriptionCustomers = activeSubscriptionCount(subscriptions);
  const planCustomers = countFromRecurringPlan(plan);
  const customers = Math.max(subscriptionCustomers, planCustomers);
  const status = String(plan.status || plan.state || 'Active');
  return {
    id: String(plan.id || plan.uuid || ('clover-api-plan-' + index)),
    plan: String(plan.name || plan.planName || plan.description || plan.id || ('Clover plan ' + (index + 1))).trim(),
    subtotal,
    customers,
    frequency,
    lastRun: String(plan.lastRun || plan.lastRunDate || plan.lastPaymentDate || ''),
    status: status.toLowerCase() === 'deleted' ? 'Inactive' : status,
    possibleWeekly: Math.round(weeklyEquivalent(subtotal, frequency) * customers * 100) / 100,
    source: 'Clover recurring API',
    cloverSubscriptionRows: subscriptions.length,
    cloverPlanCustomerCount: planCustomers
  };
}
async function syncCloverRecurringPlans(data) {
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  const attempted = [];
  const planPaths = [
    '/recurring/v1/plans?limit=100',
    '/recurring/v1/merchants/' + CLOVER_MERCHANT_ID + '/plans?limit=100'
  ];
  let plansBody;
  for (const planPath of planPaths) {
    try {
      attempted.push(planPath);
      plansBody = await cloverGetRecurring(planPath);
      break;
    } catch (err) {
      data.integrations.clover.lastRecurringPlanSyncError = String(err && err.message || err);
    }
  }
  const rawPlans = collectionElements(plansBody);
  if (!rawPlans.length) throw new Error(data.integrations.clover.lastRecurringPlanSyncError || 'Clover recurring API returned no plan rows.');
  const importedPlans = [];
  const importedMembers = [];
  for (let index = 0; index < rawPlans.length; index += 1) {
    const plan = rawPlans[index];
    const planId = plan.id || plan.uuid;
    let subscriptions = [];
    if (planId) {
      const subscriptionPaths = [
        '/recurring/v1/plans/' + encodeURIComponent(planId) + '/subscriptions?limit=200',
        '/recurring/v1/merchants/' + CLOVER_MERCHANT_ID + '/plans/' + encodeURIComponent(planId) + '/subscriptions?limit=200'
      ];
      for (const subscriptionPath of subscriptionPaths) {
        try {
          subscriptions = collectionElements(await cloverGetRecurring(subscriptionPath));
          break;
        } catch (err) {
          data.integrations.clover.lastRecurringPlanSyncError = String(err && err.message || err);
        }
      }
    }
    importedMembers.push(...membersFromRecurringSubscriptions(plan, subscriptions));
    importedPlans.push(cleanRecurringPlanFromApi(plan, subscriptions, index));
  }
  const plans = cleanCloverPlanSummary(importedPlans);
  const summary = summarizeCloverPlans(plans);
  data.integrations.clover.lastRecurringPlanSyncDetails = importedPlans.map(plan => ({
    plan: plan.plan,
    customers: Number(plan.customers || 0),
    subscriptionRows: Number(plan.cloverSubscriptionRows || 0),
    planCustomerCount: Number(plan.cloverPlanCustomerCount || 0),
    amount: Number(plan.subtotal || plan.amount || 0),
    frequency: plan.frequency || ''
  }));
  const savedSummary = data.integrations.clover.recurringPlanSummary || {};
  const savedActive = Number(savedSummary.activeCustomers || 0);
  const apiActive = Number(summary.activeCustomers || 0);
  if (savedActive > apiActive) {
    throw new Error('Clover recurring API returned ' + apiActive + ' active subscriptions, less than saved Plan Manager total ' + savedActive + '. Keeping saved plan totals.');
  }
  const savedMembers = Array.isArray(data.integrations.clover.recurringPlanMembers) ? data.integrations.clover.recurringPlanMembers : [];
  const savedNamedMembers = savedMembers.filter(member => String(member.customer || '').trim() && member.customer !== 'Clover recurring customer');
  const importedNamedMembers = importedMembers.filter(member => String(member.customer || '').trim() && member.customer !== 'Clover recurring customer');
  const keepSavedMembers = savedNamedMembers.length > importedNamedMembers.length;
  data.integrations.clover.recurringPlans = plans;
  data.integrations.clover.recurringPlanMembers = keepSavedMembers ? enrichRecurringRoster(savedMembers, importedMembers) : importedMembers;
  data.integrations.clover.recurringPlanSummary = summary;
  data.integrations.clover.lastRecurringPlanSyncAt = new Date().toISOString();
  data.integrations.clover.lastRecurringPlanSyncError = '';
  data.integrations.clover.lastRecurringPlanSyncSource = 'Clover recurring API';
  data.integrations.clover.lastRecurringPlanSyncPaths = attempted;
  data.integrations.clover.lastRecurringMemberSyncWarning = keepSavedMembers ? ('Clover returned ' + importedNamedMembers.length + ' named recurring customers, less than saved roster ' + savedNamedMembers.length + '. Keeping saved recurring roster.') : '';
  return { recurringPlans: plans.length, summary: data.integrations.clover.recurringPlanSummary };
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
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Payment</title>' + BROWSER_ICON_LINKS + '<link rel="stylesheet" href="/styles.css"></head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure Clover payment</div></div></a></div><h1>Complete your WheelsonAuto payment</h1><p>This payment opens on Clover secure checkout. WheelsonAuto never stores your card or bank details.</p></div><main class="public-main"><section class="card section"><div class="grid two"><div class="item"><strong>Customer</strong><div>' + safeName + '</div><div class="muted">' + vehicle + '</div></div><div class="item"><strong>Amount due</strong><div class="money">' + amount + '</div><div class="muted">' + escapeHtml(request.frequency || 'Recurring payment') + '</div></div></div>' + (message ? '<div class="notice" style="margin-top:12px">' + escapeHtml(message) + '</div>' : '') + '<form method="POST" action="/api/public/payment-links/' + encodeURIComponent(request.id) + '/checkout" style="margin-top:14px"><button class="btn primary" type="submit">Pay securely with Clover</button><a class="btn" href="https://www.wheelsonauto.com/">Back to WheelsonAuto</a></form></section></main></div></body></html>';
}
function paymentResultHtml(title, message) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Payment</title>' + BROWSER_ICON_LINKS + '<link rel="stylesheet" href="/styles.css"></head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure Clover payment</div></div></a></div><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p></div><main class="public-main"><section class="card section"><a class="btn primary" href="https://www.wheelsonauto.com/">Back to WheelsonAuto</a></section></main></div></body></html>';
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
function createCardSetupRequest(data, payload) {
  const autopay = cleanAutopayPayload({
    ...payload,
    status: 'Waiting on card setup',
    tone: 'warn',
    paymentSetup: 'Waiting on customer authorization',
    nextRun: payload.nextRun || payload.firstRun || 'After card setup'
  });
  const request = {
    id: 'setup-' + crypto.randomBytes(12).toString('hex'),
    recurringPaymentId: autopay.id,
    customer: autopay.customer,
    phone: autopay.phone,
    email: autopay.email,
    vehicle: autopay.vehicle,
    vehicleId: autopay.vehicleId,
    vin: autopay.vin,
    licensePlate: autopay.licensePlate,
    tempTag: autopay.tempTag,
    tracker: autopay.tracker,
    amount: autopay.amount,
    frequency: autopay.frequency,
    firstRun: autopay.nextRun,
    cloverPlanId: String(payload.cloverPlanId || payload.planId || '').trim(),
    status: 'Open',
    source: 'WheelsonAuto card setup',
    createdAt: new Date().toISOString(),
    url: ''
  };
  request.url = PUBLIC_BASE_URL + '/setup-card/' + request.id;
  autopay.cardSetupRequestId = request.id;
  autopay.cardSetupUrl = request.url;
  autopay.cloverPlanId = request.cloverPlanId;
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  data.cardSetupRequests = Array.isArray(data.cardSetupRequests) ? data.cardSetupRequests : [];
  data.recurringPayments.unshift(autopay);
  data.cardSetupRequests.unshift(request);
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  if (autopay.customer && !data.customers.some(c => String(c.name || '').toLowerCase() === autopay.customer.toLowerCase())) {
    data.customers.unshift({ id: 'cus-' + Date.now(), name: autopay.customer, phone: autopay.phone, email: autopay.email, vehicle: autopay.vehicle, vehicleId: autopay.vehicleId, licensePlate: autopay.licensePlate, tempTag: autopay.tempTag, tracker: autopay.tracker, contract: 'Autopay card setup', balance: 0, source: 'WheelsonAuto' });
  }
  return { autopay, request };
}
function setupCardHtml(request, message = '') {
  const setupReady = !!(CLOVER_ECOMMERCE_PUBLIC_KEY && CLOVER_ECOMMERCE_PRIVATE_KEY);
  const tokenBase = CLOVER_TOKEN_BASE;
  const sdkUrl = CLOVER_ENV === 'sandbox' ? 'https://checkout.sandbox.dev.clover.com/sdk.js' : 'https://checkout.clover.com/sdk.js';
  const config = {
    requestId: request.id,
    publicKey: CLOVER_ECOMMERCE_PUBLIC_KEY,
    merchantId: CLOVER_MERCHANT_ID,
    sdkUrl,
    tokenUrl: tokenBase + '/v1/tokens',
    submitUrl: '/api/public/card-setup/' + encodeURIComponent(request.id) + '/complete'
  };
  const disabled = setupReady ? '' : ' disabled';
  const amount = '$' + Number(request.amount || 0).toLocaleString();
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Card Setup</title>' + BROWSER_ICON_LINKS + '<link rel="stylesheet" href="/styles.css"><script src="' + sdkUrl + '"></script></head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure card setup</div></div></a></div><h1>Set up automatic payments</h1><p>Save your card securely with Clover so WheelsonAuto can run authorized recurring and manual catch-up payments.</p></div><main class="public-main"><section class="card section"><div class="grid two"><div class="item"><strong>Customer</strong><div>' + escapeHtml(request.customer || 'Customer') + '</div><div class="muted">' + escapeHtml(request.vehicle || 'WheelsonAuto account') + '</div></div><div class="item"><strong>Recurring amount</strong><div class="money">' + amount + '</div><div class="muted">' + escapeHtml(request.frequency || 'Weekly') + '</div></div></div>' + (message ? '<div class="notice" style="margin-top:12px">' + escapeHtml(message) + '</div>' : '') + (!setupReady ? '<div class="notice" style="margin-top:12px">Card setup is not ready yet. WheelsonAuto needs the Clover Ecommerce public key and private key in Render.</div>' : '') + '<form id="cardSetupForm" class="form" style="margin-top:14px"><div class="field span2"><label>Name on card</label><input id="cardName" autocomplete="cc-name" value="' + escapeHtml(request.customer || '') + '"' + disabled + '></div><div class="field span2"><label>Card number</label><div id="cardNumber" class="clover-field"></div><div id="cardNumberErrors" class="small err"></div></div><div class="field"><label>Expiration</label><div id="cardDate" class="clover-field"></div><div id="cardDateErrors" class="small err"></div></div><div class="field"><label>CVV</label><div id="cardCvv" class="clover-field"></div><div id="cardCvvErrors" class="small err"></div></div><div class="field"><label>ZIP</label><div id="cardZip" class="clover-field"></div><div id="cardZipErrors" class="small err"></div></div><label class="check span2"><input id="consent" type="checkbox"' + disabled + '> I authorize WheelsonAuto to save this card with Clover and charge authorized recurring payments, retries, and manual catch-up payments for my account.</label><div class="notice span2">Your card is entered in Clover secure fields for tokenization. WheelsonAuto stores only the Clover saved-card/customer reference, not the card number or CVV.</div><div class="span2 actions"><button class="btn primary" type="submit"' + disabled + '>Save card with Clover</button><a class="btn" href="https://www.wheelsonauto.com/">Cancel</a></div></form><div id="setupMessage" class="notice" style="display:none;margin-top:12px"></div></section></main></div><script>window.__CARD_SETUP__=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';</script><script src="/card-setup.js?v=clover-iframe-1"></script></body></html>';
}
async function completeCardSetup(data, request, payload) {
  const token = cleanPaymentSource(payload.token || payload.source || '');
  if (!isCloverEcommerceToken(token)) throw new Error('Clover did not return a valid card token.');
  const name = splitName(request.customer);
  const customer = await cloverPostCardCustomer({
    email: request.email || undefined,
    firstName: name.firstName,
    lastName: name.lastName,
    source: token
  });
  const savedCard = firstElement(customer.sources) || {};
  const cardSource = String(savedCard.id || savedCard.source || savedCard.token || '');
  let subscription = null;
  if (request.cloverPlanId) {
    subscription = await cloverPostRecurring('/recurring/v1/plans/' + encodeURIComponent(request.cloverPlanId) + '/subscriptions', {
      collectionMethod: 'CHARGE_AUTOMATICALLY',
      customerId: customer.id,
      amount: Number(request.amount || 0),
      startDate: request.firstRun || undefined
    });
  }
  request.status = subscription ? 'Card saved and Clover subscription created' : 'Card saved for manual charges';
  request.completedAt = new Date().toISOString();
  request.cloverCustomerId = customer.id || '';
  request.cloverPaymentSource = cardSource || token;
  request.cloverCardId = String(savedCard.id || savedCard || '');
  request.cloverSubscriptionId = subscription && subscription.id || '';
  const recurring = (data.recurringPayments || []).find(row => row.id === request.recurringPaymentId);
  if (recurring) {
    recurring.status = 'Active';
    recurring.tone = 'good';
    recurring.paymentSetup = subscription ? 'Active in Clover' : 'Card saved for WheelsonAuto charges';
    recurring.cloverCustomerId = customer.id || '';
    recurring.cloverPaymentSource = cardSource || token;
    recurring.cloverCardId = request.cloverCardId;
    recurring.cloverSubscriptionId = request.cloverSubscriptionId;
    recurring.cardLabel = payload.brand || savedCard.brand || savedCard.cardBrand || '';
    recurring.cardLast4 = payload.last4 || savedCard.last4 || '';
    recurring.cardSavedAt = new Date().toISOString();
    recurring.autoChargeEnabled = true;
    recurring.autopayManagedBy = 'WheelsonAuto';
    recurring.notes = [recurring.notes, 'Customer authorized card-on-file through WheelsonAuto setup link.'].filter(Boolean).join('\n');
  }
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  const existing = data.customers.find(c => String(c.name || '').toLowerCase() === String(request.customer || '').toLowerCase());
  const customerPatch = { cloverCustomerId: customer.id || '', cardLast4: payload.last4 || savedCard.last4 || '', cardLabel: payload.brand || savedCard.brand || savedCard.cardBrand || '', source: 'WheelsonAuto card setup' };
  if (existing) Object.assign(existing, customerPatch);
  await writeData(data);
  return { customer, subscription, recurring };
}
function allRecurringRows(data) {
  return [
    ...(((data.integrations || {}).clover || {}).recurringPlanMembers || []),
    ...(data.recurringPayments || [])
  ];
}
function findRecurringRow(data, id) {
  const rows = allRecurringRows(data);
  return rows.find(row => row && row.id === id) || rows.find(row => row && row.cloverSubscriptionId && row.cloverSubscriptionId === id) || null;
}
function updateRecurringChargeState(data, id, patch) {
  const local = (data.recurringPayments || []).find(row => row.id === id || row.cloverSubscriptionId === id);
  if (local) Object.assign(local, patch);
  const member = ((((data.integrations || {}).clover || {}).recurringPlanMembers || [])).find(row => row.id === id || row.cloverSubscriptionId === id);
  if (member) Object.assign(member, patch);
}
function localDateKey(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function recurringDateKey(row) {
  const raw = String(row && row.nextRun || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'today' || raw.includes('today')) return localDateKey();
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}
function isWheelsonAutoManagedAutopay(row) {
  return !!(row && row.autoChargeEnabled && hasWheelsonAutoSavedCard(row));
}
function isDueForWheelsonAutoAutopay(row, dateKey = localDateKey()) {
  const status = String(row && row.status || '').toLowerCase();
  if (Number(row && (row.retryCount || row.failedAttempts) || 0) >= 2) return false;
  if (status !== 'active' && !status.includes('1x failed')) return false;
  if (!isWheelsonAutoManagedAutopay(row)) return false;
  if (recurringDateKey(row) !== dateKey) return false;
  return String(row.lastAutoChargeDate || '') !== dateKey;
}
function patchRecurringAdminState(data, id, patch) {
  const stamp = new Date().toISOString();
  const adminPatch = { ...patch, updatedAt: stamp };
  let found = false;
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  data.recurringPayments.forEach(row => {
    if (row && (row.id === id || row.cloverSubscriptionId === id)) {
      Object.assign(row, adminPatch);
      found = true;
    }
  });
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  const members = data.integrations.clover.recurringPlanMembers = Array.isArray(data.integrations.clover.recurringPlanMembers) ? data.integrations.clover.recurringPlanMembers : [];
  members.forEach(row => {
    if (row && (row.id === id || row.cloverSubscriptionId === id)) {
      Object.assign(row, adminPatch);
      found = true;
    }
  });
  return found;
}
function chargeReference() {
  return ('WOA' + Date.now().toString(36)).slice(-12).toUpperCase();
}
async function chargeSavedRecurringCard(data, payload, req) {
  const recurring = findRecurringRow(data, payload.recurringPaymentId || payload.id);
  if (!recurring) throw new Error('Recurring customer was not found. Sync Clover recurring customers and try again.');
  let customerSource = recurringCustomerSource(recurring);
  let cardSource = recurringCardChargeSource({ ...recurring, cloverPaymentSource: payload.cloverPaymentSource || recurring.cloverPaymentSource });
  if ((!customerSource || !cardSource) && recurring.cloverSubscriptionId) {
    try {
      const fresh = await cloverGetRecurring('/recurring/v1/subscriptions/' + encodeURIComponent(recurring.cloverSubscriptionId));
      customerSource = customerSource || recurringCustomerSource(fresh);
      cardSource = cardSource || recurringCardChargeSource(fresh);
      if (customerSource || cardSource) {
        recurring.cloverCustomerId = recurring.cloverCustomerId || customerSource;
        recurring.cloverPaymentSource = recurring.cloverPaymentSource || cardSource;
        recurring.cardLabel = recurring.cardLabel || recurringCardLabel(fresh);
        recurring.cardLast4 = recurring.cardLast4 || recurringCardLast4(fresh);
        updateRecurringChargeState(data, recurring.id, {
          cloverCustomerId: recurring.cloverCustomerId,
          cloverPaymentSource: recurring.cloverPaymentSource,
          cardLabel: recurring.cardLabel,
          cardLast4: recurring.cardLast4
        });
      }
    } catch (err) {
      data.integrations = data.integrations || {};
      data.integrations.clover = data.integrations.clover || {};
      data.integrations.clover.lastManualChargeLookupError = String(err && err.message || err);
    }
  }
  const source = cardSource || (hasWheelsonAutoSavedCard(recurring) ? customerSource : '');
  if (!source) throw new Error('Clover shows a card on file for this recurring customer, but it did not return a chargeable Ecommerce saved-card token. Use Pay link for this charge, or save the customer card through WheelsonAuto checkout before using Charge saved card.');
  const amount = Number(payload.amount || recurring.amount || 0);
  if (!amount || amount <= 0) throw new Error('Enter a valid amount before charging.');
  const ref = chargeReference();
  const chargeBody = {
    amount: cents(amount),
    currency: 'USD',
    capture: true,
    ecomind: 'ecom',
    source,
    description: 'WheelsonAuto ' + (recurring.frequency || 'recurring') + ' payment',
    external_reference_id: ref,
    external_customer_reference: String(recurring.cloverCustomerId || recurring.customer || '').slice(0, 64),
    receipt_email: recurring.email || undefined
  };
  if (cardSource && source === cardSource) {
    chargeBody.stored_credentials = { sequence: 'SUBSEQUENT', is_scheduled: false, initiator: 'MERCHANT' };
  }
  const charge = await cloverPostCharge({
    idempotencyKey: 'woa-' + (payload.recurringPaymentId || recurring.id) + '-' + cents(amount) + '-' + Date.now(),
    charge: chargeBody
  }, req);
  const status = String(charge.status || charge.result || '').toLowerCase();
  const paid = status === 'paid' || status === 'succeeded' || status === 'success' || charge.paid === true || charge.captured === true;
  const payment = {
    id: 'clover-manual-charge-' + (charge.id || Date.now()),
    cloverChargeId: charge.id || charge.charge || '',
    date: new Date().toLocaleString('en-US'),
    customer: recurring.customer,
    method: 'Clover saved card',
    amount,
    status: paid ? 'Paid' : (charge.status || charge.result || 'Submitted'),
    tone: paid ? 'good' : 'warn',
    source: 'Clover saved-card charge',
    notes: String(payload.note || '').trim()
  };
  data.payments = Array.isArray(data.payments) ? data.payments : [];
  data.payments.unshift(payment);
  updateRecurringChargeState(data, recurring.id, {
    status: paid ? 'Active' : 'Payment submitted',
    tone: paid ? 'good' : 'warn',
    retryCount: paid ? 0 : (recurring.retryCount || recurring.failedAttempts || 0),
    failedAttempts: paid ? 0 : (recurring.failedAttempts || recurring.retryCount || 0),
    nextRun: String(payload.nextRun || recurring.nextRun || '').trim(),
    lastPaymentAt: new Date().toISOString(),
    lastCloverChargeId: payment.cloverChargeId,
    lastManualChargeAt: new Date().toISOString()
  });
  await writeData(data);
  return { charge, payment, recurring };
}
function nextDateAfterCharge(dateKey, frequency) {
  const d = new Date(dateKey + 'T12:00:00');
  const f = String(frequency || '').toLowerCase();
  if (f.includes('bi')) d.setDate(d.getDate() + 14);
  else if (f.includes('month')) d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 7);
  return localDateKey(d);
}
async function runWheelsonAutoAutopay(options = {}) {
  if (woaAutopayStatus.inFlight) return { ok: true, skipped: true, reason: 'already running', status: woaAutopayStatus };
  woaAutopayStatus.inFlight = true;
  woaAutopayStatus.lastStartedAt = new Date().toISOString();
  woaAutopayStatus.lastError = '';
  const dateKey = options.dateKey || localDateKey();
  const result = { dateKey, charged: 0, skipped: 0, errors: [] };
  try {
    const data = await readData();
    data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
    const due = data.recurringPayments.filter(row => isDueForWheelsonAutoAutopay(row, dateKey));
    for (const row of due) {
      try {
        const nextRun = nextDateAfterCharge(dateKey, row.frequency);
        await chargeSavedRecurringCard(data, {
          recurringPaymentId: row.id,
          amount: row.amount,
          nextRun,
          note: 'WheelsonAuto autopay charged for due date ' + dateKey
        }, null);
        row.lastAutoChargeDate = dateKey;
        row.lastAutoChargeAt = new Date().toISOString();
        row.nextRun = nextRun;
        row.status = 'Active';
        row.tone = 'good';
        row.retryCount = 0;
        row.failedAttempts = 0;
        row.lastAutoChargeResult = 'Paid';
        result.charged += 1;
      } catch (err) {
        const attempts = Math.min(2, Number(row.retryCount || row.failedAttempts || 0) + 1);
        row.retryCount = attempts;
        row.failedAttempts = attempts;
        row.status = attempts >= 2 ? '2x failed - contact customer' : '1x failed - retrying';
        row.tone = attempts >= 2 ? 'bad' : 'warn';
        row.lastAutoChargeResult = row.status;
        row.lastAutoChargeError = String(err && err.message || err);
        row.lastAutoChargeAttemptDate = dateKey;
        row.lastAutoChargeAttemptAt = new Date().toISOString();
        result.errors.push((row.customer || row.id) + ': ' + row.lastAutoChargeError);
      }
    }
    result.skipped = data.recurringPayments.length - due.length;
    data.integrations = data.integrations || {};
    data.integrations.wheelsonAutoAutopay = {
      enabled: true,
      intervalMs: WOA_AUTOPAY_MS,
      lastStartedAt: woaAutopayStatus.lastStartedAt,
      lastFinishedAt: new Date().toISOString(),
      lastResult: result
    };
    await writeData(data);
    woaAutopayStatus.lastFinishedAt = data.integrations.wheelsonAutoAutopay.lastFinishedAt;
    woaAutopayStatus.lastResult = result;
    woaAutopayStatus.lastError = result.errors[0] || '';
    return { ok: result.errors.length === 0, skipped: false, ...result, status: woaAutopayStatus };
  } catch (err) {
    woaAutopayStatus.lastFinishedAt = new Date().toISOString();
    woaAutopayStatus.lastError = String(err && err.message || err);
    woaAutopayStatus.lastResult = { dateKey, errors: [woaAutopayStatus.lastError] };
    return { ok: false, skipped: false, error: woaAutopayStatus.lastError, status: woaAutopayStatus };
  } finally {
    woaAutopayStatus.inFlight = false;
  }
}
async function attachCloverCheckout(data, request) {
  const name = splitName(request.customer);
  const checkout = await cloverPostCheckout({
    ...(CLOVER_HCO_PAGE_CONFIG_UUID ? { pageConfigUuid: CLOVER_HCO_PAGE_CONFIG_UUID } : {}),
    customer: { email: request.email || undefined, firstName: name.firstName, lastName: name.lastName, phoneNumber: request.phone || undefined },
    redirectUrls: { success: PUBLIC_BASE_URL + '/pay/' + request.id + '/success', failure: PUBLIC_BASE_URL + '/pay/' + request.id + '/failure' },
    shoppingCart: { lineItems: [{ name: 'WheelsonAuto ' + (request.frequency || 'recurring') + ' payment', note: request.vehicle || 'Recurring payment', price: cents(request.amount), unitQty: 1 }] }
  });
  request.status = 'Clover checkout ready';
  request.checkoutSessionId = checkout.checkoutSessionId || '';
  request.checkoutHref = checkout.href;
  request.checkoutCreatedAt = new Date().toISOString();
  await writeData(data);
  return checkout;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
    if (await staticFile(res, url.pathname)) return;
    if (url.pathname === '/apply' && req.method === 'GET') return send(res, 200, await appHtml({ publicMode: true }));
    if (url.pathname.startsWith('/setup-card/') && req.method === 'GET') {
      const requestId = url.pathname.split('/').filter(Boolean)[1];
      const data = await readData();
      data.cardSetupRequests = Array.isArray(data.cardSetupRequests) ? data.cardSetupRequests : [];
      const request = data.cardSetupRequests.find(item => item.id === requestId);
      if (!request) return send(res, 404, paymentResultHtml('Card setup link not found', 'Please contact WheelsonAuto so we can send a fresh card setup link.'));
      if (String(request.status || '').toLowerCase().includes('card saved')) {
        return send(res, 200, paymentResultHtml('Card already saved', 'This WheelsonAuto card setup link has already been completed.'));
      }
      return send(res, 200, setupCardHtml(request));
    }
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
      const checkout = await attachCloverCheckout(data, request);
      return send(res, 302, '', 'text/plain', { Location: checkout.href });
    }
    if (url.pathname === '/api/public/applications' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const app = { id: payload.id || ('app-' + Date.now()), submittedAt: payload.submittedAt || new Date().toISOString(), stage: 'New', status: 'New', score: payload.score || scoreApplication(payload), ...payload };
      data.applications = Array.isArray(data.applications) ? data.applications : [];
      data.websiteLeads = Array.isArray(data.websiteLeads) ? data.websiteLeads : [];
      data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
      if (!data.applications.some(existing => existing.id === app.id)) data.applications.unshift(app);
      const selectedVehicle = data.vehicles.find(vehicle => vehicle.id === app.vehicleId);
      if (selectedVehicle && ['Ready', 'Coming soon', 'Pending application'].includes(selectedVehicle.status)) {
        selectedVehicle.status = 'Pending application';
        selectedVehicle.pendingApplicant = app.name || '';
        selectedVehicle.pendingApplicationId = app.id;
        selectedVehicle.lastLeadAt = app.submittedAt;
        selectedVehicle.notes = [selectedVehicle.notes, 'Website application submitted by ' + (app.name || 'applicant') + ' on ' + app.submittedAt].filter(Boolean).join('\n');
      }
      if (!data.websiteLeads.some(existing => existing.applicationId === app.id)) data.websiteLeads.unshift({ id: 'lead-' + Date.now(), applicationId: app.id, source: 'wheelsonauto.com/apply', name: app.name, phone: app.phone, email: app.email, vehicle: app.vehicle, vehicleId: app.vehicleId, created: 'Just now', status: 'Submitted' });
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, 201, { ok: true, application: app });
    }
    if (url.pathname.startsWith('/api/public/card-setup/') && url.pathname.endsWith('/complete') && req.method === 'POST') {
      const requestId = url.pathname.split('/').filter(Boolean)[3];
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.cardSetupRequests = Array.isArray(data.cardSetupRequests) ? data.cardSetupRequests : [];
      const request = data.cardSetupRequests.find(item => item.id === requestId);
      if (!request) return json(res, 404, { ok: false, error: 'Card setup link was not found.' });
      try {
        const result = await completeCardSetup(data, request, payload);
        return json(res, 201, { ok: true, recurring: result.recurring, cloverCustomerId: request.cloverCustomerId, cloverSubscriptionId: request.cloverSubscriptionId });
      } catch (err) {
        request.status = 'Card setup failed';
        request.lastError = String(err && err.message || err);
        request.lastFailedAt = new Date().toISOString();
        await writeData(data);
        return json(res, 400, { ok: false, error: request.lastError });
      }
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const pin = new URLSearchParams(await readBody(req)).get('pin');
      if (LOGIN_PIN && pin === LOGIN_PIN) return send(res, 302, '', 'text/plain', { 'Set-Cookie': 'woa_session=' + sessionCookie({ id: 'owner', name: 'Owner admin', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' }) + '; HttpOnly; SameSite=Lax; Path=/', Location: '/' });
      const data = await readData();
      const staff = findStaffByPin(data, pin);
      if (staff) {
        const user = staffLoginUser(staff);
        user.companyName = companyNameById(data, user.organizationId);
        return send(res, 302, '', 'text/plain', { 'Set-Cookie': 'woa_session=' + sessionCookie(user) + '; HttpOnly; SameSite=Lax; Path=/', Location: '/' });
      }
      return send(res, 401, loginPage('That PIN did not match.'));
    }
    if (url.pathname === '/logout') return send(res, 302, '', 'text/plain', { 'Set-Cookie': 'woa_session=; Max-Age=0; Path=/', Location: '/' });
    const user = sessionUser(req);
    if (!user) return send(res, 200, loginPage());
    if (url.pathname.startsWith('/api/') && !apiAllowedForUser(user, url.pathname)) return json(res, 403, { ok: false, error: 'This account does not have access to that action.' });
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, await readData());
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const incoming = JSON.parse(await readBody(req) || '{}');
      const current = await readData();
      await writeData(stateForUserWrite(current, incoming, user));
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/import/vehicle-sheet' && req.method === 'POST') {
      const data = await readData();
      const imported = await mergeVehicleImport(data);
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, 200, { ok: true, imported, vehicles: (data.vehicles || []).length, customers: (data.customers || []).length, contracts: (data.contracts || []).length });
    }
    if (url.pathname === '/api/sync/status' && req.method === 'GET') return json(res, 200, { ok: true, autoSync: autoSyncStatus });
    if (url.pathname === '/api/sync/auto' && req.method === 'POST') {
      const result = await runAutoSync({ source: 'dashboard', force: url.searchParams.get('force') === '1' });
      return json(res, result.ok ? 200 : 207, result);
    }
    if (url.pathname === '/api/woa-autopay/status' && req.method === 'GET') return json(res, 200, { ok: true, autopay: woaAutopayStatus });
    if (url.pathname === '/api/woa-autopay/run' && req.method === 'POST') {
      const result = await runWheelsonAutoAutopay({ source: 'dashboard' });
      return json(res, result.ok ? 200 : 207, result);
    }
    if (url.pathname === '/api/system/readiness' && req.method === 'POST') {
      const data = await readData();
      return json(res, 200, systemReadiness(data));
    }
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
    if (url.pathname === '/api/integrations/clover/ecommerce-diagnostics' && req.method === 'POST') {
      try {
        const diagnostic = await cloverEcommerceDiagnostics();
        return json(res, diagnostic.savedCardApi.authorized ? 200 : 401, { ok: diagnostic.savedCardApi.authorized, diagnostic });
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err && err.message || err) });
      }
    }
    if (url.pathname === '/api/integrations/clover/import-plan-summary' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.clover = data.integrations.clover || {};
      const plans = cleanCloverPlanSummary(payload.plans || []);
      data.integrations.clover.recurringPlans = plans;
      data.integrations.clover.recurringPlanSummary = summarizeCloverPlans(plans);
      data.integrations.clover.lastRecurringPlanSyncAt = new Date().toISOString();
      data.integrations.clover.lastRecurringPlanSyncError = '';
      data.integrations.clover.lastRecurringPlanSyncSource = 'Manual Plan Manager import';
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, 200, { ok: true, imported: plans.length, summary: data.integrations.clover.recurringPlanSummary });
    }
    if (url.pathname === '/api/integrations/clover/import-recurring-roster' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.clover = data.integrations.clover || {};
      const imported = cleanRecurringRosterImport(payload.members || payload.rows || []);
      data.integrations.clover.recurringPlanMembers = mergeRecurringRoster(data.integrations.clover.recurringPlanMembers || [], imported);
      data.integrations.clover.lastRecurringRosterImportAt = new Date().toISOString();
      data.integrations.clover.lastRecurringMemberSyncWarning = '';
      await writeData(data);
      return json(res, 200, { ok: true, imported: imported.length, members: data.integrations.clover.recurringPlanMembers.length });
    }
    if (url.pathname === '/api/integrations/clover/sync-customers' && req.method === 'POST') {
      const data = await readData();
      const synced = await syncCloverIntoData(data, { payments: false, recurring: false });
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, synced.errors.length ? 500 : 200, { ok: synced.errors.length === 0, imported: synced.customers, customers: data.customers.length, error: synced.errors[0] || '' });
    }
    if (url.pathname === '/api/integrations/clover/sync-payments' && req.method === 'POST') {
      const data = await readData();
      const synced = await syncCloverIntoData(data, { customers: false, recurring: false });
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, synced.errors.length ? 500 : 200, { ok: synced.errors.length === 0, imported: synced.payments, recurring: data.recurringPayments.length, payments: data.payments.length, error: synced.errors[0] || '' });
    }
    if (url.pathname === '/api/integrations/clover/sync-recurring' && req.method === 'POST') {
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.clover = data.integrations.clover || {};
      try {
        const synced = await syncCloverRecurringPlans(data);
        data.integrations.clover.connected = true;
        await protectConcurrentLocalWrites(data);
        await writeData(data);
        return json(res, 200, { ok: true, ...synced });
      } catch (err) {
        data.integrations.clover.lastRecurringPlanSyncError = String(err && err.message || err);
        await protectConcurrentLocalWrites(data);
        await writeData(data);
        return json(res, 500, { ok: false, error: data.integrations.clover.lastRecurringPlanSyncError, currentSummary: data.integrations.clover.recurringPlanSummary || null });
      }
    }
    if (url.pathname === '/api/integrations/clover/sync-all' && req.method === 'POST') {
      const data = await readData();
      const synced = await syncCloverIntoData(data);
      const vehicleSheet = await mergeVehicleImport(data);
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, synced.errors.length ? 207 : 200, { ok: synced.errors.length === 0, ...synced, vehicleSheet, totalCustomers: (data.customers || []).length, totalPayments: (data.payments || []).length });
    }
    if (url.pathname === '/api/api-providers' && req.method === 'GET') {
      const data = await readData();
      return json(res, 200, { ok: true, providers: Array.isArray(data.apiProviders) ? data.apiProviders : [] });
    }
    if (url.pathname === '/api/api-providers' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.apiProviders = Array.isArray(data.apiProviders) ? data.apiProviders : [];
      const provider = cleanApiProviderPayload(payload);
      const existing = data.apiProviders.find(item => item.id === provider.id);
      if (existing) Object.assign(existing, provider, { createdAt: existing.createdAt || provider.createdAt });
      else data.apiProviders.unshift(provider);
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.messages.unshift({ id: 'msg-api-' + Date.now(), date: new Date().toLocaleString('en-US'), customer: provider.name, channel: 'Internal log', template: 'API setup', status: provider.status, subject: provider.group, body: provider.liveTest || provider.notes || '' });
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, 200, { ok: true, provider });
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      const task = cleanTaskPayload(payload);
      const existing = data.tasks.find(item => item.id === task.id);
      if (existing) Object.assign(existing, task, { createdAt: existing.createdAt || task.createdAt });
      else data.tasks.unshift(task);
      await protectConcurrentLocalWrites(data);
      await writeData(data);
      return json(res, 200, { ok: true, task });
    }
    if (url.pathname === '/api/recurring-payments' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const autopay = cleanAutopayPayload(payload);
      data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
      data.customers = Array.isArray(data.customers) ? data.customers : [];
      data.recurringPayments.unshift(autopay);
      if (autopay.customer && !data.customers.some(c => String(c.name || '').toLowerCase() === autopay.customer.toLowerCase())) {
        data.customers.unshift({ id: 'cus-' + Date.now(), name: autopay.customer, phone: autopay.phone, email: autopay.email, vehicle: autopay.vehicle, vehicleId: autopay.vehicleId, licensePlate: autopay.licensePlate, tempTag: autopay.tempTag, tracker: autopay.tracker, contract: 'Autopay setup', balance: 0, source: 'WheelsonAuto', cloverCustomerId: autopay.cloverCustomerId });
      }
      await writeData(data);
      return json(res, 201, { ok: true, autopay });
    }
    if (url.pathname === '/api/recurring-payments/update' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const id = String(payload.recurringPaymentId || payload.id || '').trim();
      const recurring = findRecurringRow(data, id);
      const nextRun = String(payload.nextRun || (recurring && recurring.nextRun) || '').trim();
      const frequency = String(payload.frequency || (recurring && recurring.frequency) || 'Weekly').trim();
      const amount = payload.amount === undefined || payload.amount === '' ? undefined : Number(payload.amount);
      const status = String(payload.status || (recurring && recurring.status) || 'Active').trim();
      const paymentDay = String(payload.paymentDay || payload.chargeDay || (recurring && (recurring.paymentDay || recurring.chargeDay)) || '').trim();
      const monthlyDay = payload.monthlyDay === undefined || payload.monthlyDay === '' ? undefined : Number(payload.monthlyDay);
      const retryRule = String(payload.retryRule || (recurring && recurring.retryRule) || 'Retry once then contact').trim();
      const managedBy = String(payload.autopayManagedBy || (recurring && recurring.autopayManagedBy) || '').trim();
      if (!id || !nextRun) return json(res, 400, { ok: false, error: 'Choose a recurring customer and a WheelsonAuto due date.' });
      if (!frequency) return json(res, 400, { ok: false, error: 'Choose how often this customer should be charged.' });
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) return json(res, 400, { ok: false, error: 'Enter a valid autopay amount.' });
      if (monthlyDay !== undefined && (!Number.isFinite(monthlyDay) || monthlyDay < 1 || monthlyDay > 31)) return json(res, 400, { ok: false, error: 'Choose a valid monthly day.' });
      const enableWheelsonAutoCharge = hasWheelsonAutoSavedCard(recurring);
      const patch = {
        nextRun,
        adminNextRun: nextRun,
        frequency,
        adminFrequency: frequency,
        status,
        paymentDay,
        chargeDay: paymentDay,
        retryRule,
        adminScheduleChangedAt: new Date().toISOString(),
        autoChargeEnabled: enableWheelsonAutoCharge,
        autopayManagedBy: managedBy || (enableWheelsonAutoCharge ? 'WheelsonAuto' : (recurring && recurring.autopayManagedBy || '')),
        notes: String(payload.note || recurring && recurring.notes || '').trim()
      };
      if (amount !== undefined) patch.amount = amount;
      if (monthlyDay !== undefined) patch.monthlyDay = monthlyDay;
      const found = patchRecurringAdminState(data, id, patch);
      if (!found) return json(res, 404, { ok: false, error: 'Recurring customer was not found.' });
      await writeData(data);
      return json(res, 200, { ok: true, nextRun, frequency, amount: amount !== undefined ? amount : recurring && recurring.amount, status, paymentDay, monthlyDay, retryRule, autopayManagedBy: patch.autopayManagedBy, autoChargeEnabled: enableWheelsonAutoCharge });
    }
    if (url.pathname === '/api/recurring-payments/remove' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const id = String(payload.recurringPaymentId || payload.id || '').trim();
      if (!id) return json(res, 400, { ok: false, error: 'Choose a recurring customer to remove.' });
      const removedAt = new Date().toISOString();
      const found = patchRecurringAdminState(data, id, {
        status: 'Removed',
        tone: 'bad',
        nextRun: 'Removed',
        removedAt,
        paymentSetup: 'Removed from WheelsonAuto autopay',
        notes: String(payload.note || 'Removed from WheelsonAuto autopay by admin.').trim()
      });
      if (!found) return json(res, 404, { ok: false, error: 'Recurring customer was not found.' });
      await writeData(data);
      return json(res, 200, { ok: true, removedAt });
    }
    if (url.pathname === '/api/card-setup-requests/delete' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const id = String(payload.recurringPaymentId || payload.setupRequestId || payload.id || '').trim();
      if (!id) return json(res, 400, { ok: false, error: 'Choose a card setup row to delete.' });
      data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
      data.cardSetupRequests = Array.isArray(data.cardSetupRequests) ? data.cardSetupRequests : [];
      const recurring = data.recurringPayments.find(row => row.id === id || row.cardSetupRequestId === id);
      const setupId = String(payload.setupRequestId || id || (recurring && recurring.cardSetupRequestId) || '').trim();
      const beforeRecurring = data.recurringPayments.length;
      const beforeRequests = data.cardSetupRequests.length;
      data.recurringPayments = data.recurringPayments.filter(row => row.id !== id && row.cardSetupRequestId !== id && (!setupId || row.cardSetupRequestId !== setupId));
      data.cardSetupRequests = data.cardSetupRequests.filter(request => request.id !== id && request.recurringPaymentId !== id && (!setupId || request.id !== setupId));
      const deletedRecurring = beforeRecurring - data.recurringPayments.length;
      const deletedRequests = beforeRequests - data.cardSetupRequests.length;
      if (!deletedRecurring && !deletedRequests) return json(res, 404, { ok: false, error: 'Card setup row was not found.' });
      await writeData(data);
      return json(res, 200, { ok: true, deletedRecurring, deletedRequests });
    }
    if (url.pathname === '/api/card-setup-requests' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const created = createCardSetupRequest(data, payload);
      await writeData(data);
      return json(res, 201, { ok: true, autopay: created.autopay, setupLink: created.request });
    }
    if (url.pathname === '/api/integrations/clover/manual-charge' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      try {
        const result = await chargeSavedRecurringCard(data, payload, req);
        return json(res, 201, { ok: true, charge: result.charge, payment: result.payment });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err && err.message || err) });
      }
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
      if (payload.createCheckout) {
        await attachCloverCheckout(data, request);
      } else {
        await writeData(data);
      }
      return json(res, 201, { ok: true, paymentLink: request });
    }
    if (url.pathname === '/api/webhooks/clover' && req.method === 'POST') {
      const event = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.clover = data.integrations.clover || {};
      data.integrations.clover.webhookEvents = data.integrations.clover.webhookEvents || [];
      data.integrations.clover.webhookEvents.unshift({ receivedAt: new Date().toISOString(), event });
      await writeData(data);
      setTimeout(() => runAutoSync({ source: 'clover webhook', force: true }).catch(err => console.error('Webhook auto sync failed:', err && err.message || err)), 0);
      return json(res, 200, { ok: true });
    }
    return send(res, 200, await appHtml({ publicMode: false, user }));
  } catch (err) {
    send(res, 500, 'Server error: ' + String(err && err.message || err), 'text/plain; charset=utf-8');
  }
});
server.listen(PORT, HOST, () => {
  console.log('WheelsonAuto platform running on ' + HOST + ':' + PORT);
  setTimeout(() => runAutoSync({ source: 'startup', force: true }).catch(err => console.error('Startup auto sync failed:', err && err.message || err)), AUTO_SYNC_STARTUP_DELAY_MS);
  setInterval(() => runAutoSync({ source: 'background' }).catch(err => console.error('Background auto sync failed:', err && err.message || err)), AUTO_SYNC_MS);
  setTimeout(() => runWheelsonAutoAutopay({ source: 'startup' }).catch(err => console.error('Startup WOA autopay failed:', err && err.message || err)), AUTO_SYNC_STARTUP_DELAY_MS + 5000);
  setInterval(() => runWheelsonAutoAutopay({ source: 'background' }).catch(err => console.error('Background WOA autopay failed:', err && err.message || err)), WOA_AUTOPAY_MS);
});
