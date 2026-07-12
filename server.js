const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
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
const LOGIN_USERNAME = process.env.WOA_ADMIN_USERNAME || process.env.WOA_OWNER_USERNAME || '';
const LOGIN_PASSWORD = process.env.WOA_ADMIN_PASSWORD || process.env.WOA_OWNER_PASSWORD || '';
const LOGIN_PASSWORD_HASH = process.env.WOA_ADMIN_PASSWORD_HASH || process.env.WOA_OWNER_PASSWORD_HASH || '';
const LOGIN_PASSWORD_SALT = process.env.WOA_ADMIN_PASSWORD_SALT || process.env.WOA_OWNER_PASSWORD_SALT || '';
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
const CLOVER_WEBHOOK_SECRET = process.env.CLOVER_WEBHOOK_SECRET || process.env.WOA_CLOVER_WEBHOOK_SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://wheelsonauto-platform.onrender.com').replace(/\/+$/, '');
const MESSAGING_PROVIDER = String(process.env.WOA_MESSAGING_PROVIDER || process.env.MESSAGING_PROVIDER || 'not_configured').toLowerCase();
const MESSAGING_FROM_NUMBER = process.env.WOA_MESSAGING_FROM_NUMBER || process.env.MESSAGING_FROM_NUMBER || '';
const MESSAGING_OWNER_NOTIFY_NUMBER = process.env.WOA_MESSAGING_OWNER_NOTIFY_NUMBER || process.env.MESSAGING_OWNER_NOTIFY_NUMBER || '';
const MESSAGING_WEBHOOK_SECRET = process.env.WOA_MESSAGING_WEBHOOK_SECRET || process.env.MESSAGING_WEBHOOK_SECRET || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.WOA_OPENAI_API_KEY || '';
const WOA_AI_MODEL = process.env.WOA_AI_MODEL || process.env.OPENAI_MODEL || '';
const WOA_MESSAGING_ENABLED = process.env.WOA_MESSAGING_ENABLED !== '0';
const WOA_STAR_AI_ENABLED = process.env.WOA_STAR_AI_ENABLED !== '0';
const WOA_AI_AUTO_SEND = process.env.WOA_AI_AUTO_SEND !== '0';
const WOA_AI_REPLY_DRAFTS = process.env.WOA_AI_REPLY_DRAFTS !== '0';
const WOA_EMAIL_ENABLED = process.env.WOA_EMAIL_ENABLED !== '0';
const WOA_EMAIL_PROVIDER = String(process.env.WOA_EMAIL_PROVIDER || process.env.EMAIL_PROVIDER || 'not_configured').toLowerCase();
const WOA_EMAIL_FROM = process.env.WOA_EMAIL_FROM || process.env.EMAIL_FROM || '';
const WOA_MULTI_TENANT_ENABLED = process.env.WOA_MULTI_TENANT_ENABLED === '1';
const MAIN_ORG_ID = 'org-wheelsonauto';
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.WOA_RESEND_API_KEY || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || process.env.WOA_SENDGRID_API_KEY || '';
const BROWSER_ICON_LINKS = '<link rel="icon" href="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=64"><link rel="apple-touch-icon" href="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180">';
const CSS_LINK = '<link rel="stylesheet" href="/styles.css?v=platform-20260711-star-qa-2">';
const AUTO_SYNC_MS = Math.max(30000, Number(process.env.WOA_AUTO_SYNC_MS || 60000));
const AUTO_SYNC_STARTUP_DELAY_MS = Math.max(5000, Number(process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS || 15000));
const WOA_AUTOPAY_MS = Math.max(60000, Number(process.env.WOA_AUTOPAY_MS || 300000));
const WEBHOOK_AUTO_SYNC_DELAY_MS = Math.max(1000, Number(process.env.WOA_WEBHOOK_AUTO_SYNC_DELAY_MS || 5000));
const WOA_TIME_ZONE = process.env.WOA_TIME_ZONE || 'America/New_York';
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

function stableVehicleId(base, vehicle) {
  const source = [vehicle && vehicle.vin, vehicle && vehicle.plate, vehicle && vehicle.stock, vehicle && vehicle.name, vehicle && vehicle.currentCustomer].filter(Boolean).join('|') || JSON.stringify(vehicle || {});
  return String(base || 'veh') + '-' + crypto.createHash('sha1').update(source).digest('hex').slice(0, 8);
}
function stableRecordId(base, row) {
  const source = [row && row.customer, row && row.vehicle, row && row.vin, row && row.plate, row && row.licensePlate, row && row.dateStarted].filter(Boolean).join('|') || JSON.stringify(row || {});
  return String(base || 'row') + '-' + crypto.createHash('sha1').update(source).digest('hex').slice(0, 8);
}
function repairDuplicateVehicleIds(data) {
  if (!data || !Array.isArray(data.vehicles)) return data;
  const seen = new Set();
  data.vehicles.forEach(vehicle => {
    const original = String(vehicle && vehicle.id || '').trim() || 'veh';
    if (!seen.has(original)) {
      vehicle.id = original;
      seen.add(original);
      return;
    }
    let next = stableVehicleId(original, vehicle);
    let count = 2;
    while (seen.has(next)) {
      next = stableVehicleId(original + '-' + count, vehicle);
      count += 1;
    }
    vehicle.id = next;
    seen.add(next);
  });
  return data;
}
function repairDuplicateRecordIds(data, collectionName) {
  const rows = data && data[collectionName];
  if (!Array.isArray(rows)) return data;
  const seen = new Set();
  rows.forEach(row => {
    const original = String(row && row.id || '').trim() || collectionName.slice(0, -1) || 'row';
    if (!seen.has(original)) {
      row.id = original;
      seen.add(original);
      return;
    }
    let next = stableRecordId(original, row);
    let count = 2;
    while (seen.has(next)) {
      next = stableRecordId(original + '-' + count, row);
      count += 1;
    }
    row.id = next;
    seen.add(next);
  });
  return data;
}
function loadVehicleImportSync() {
  try {
    const body = JSON.parse(fsSync.readFileSync(VEHICLE_IMPORT_FILE, 'utf8'));
    return Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return [];
  }
}
function importRowId(row, prefix) {
  return prefix + String(row && row.rowNumber || '').padStart(3, '0');
}
function findVehicleForImportRow(data, row) {
  const vehicles = Array.isArray(data && data.vehicles) ? data.vehicles : [];
  const byVin = normKey(row && row.vin);
  if (byVin) {
    const exact = vehicles.find(vehicle => normKey(vehicle && vehicle.vin) === byVin);
    if (exact) return exact;
  }
  const byPlate = normKey(row && row.licensePlate);
  if (byPlate) {
    const exact = vehicles.find(vehicle => normKey(vehicle && (vehicle.plate || vehicle.stock)) === byPlate);
    if (exact) return exact;
  }
  const bySourceRow = String(row && row.rowNumber || '');
  return vehicles.find(vehicle => String(vehicle && vehicle.sourceRow || '') === bySourceRow) || null;
}
function importRowVehiclePatch(row, vehicle) {
  const weekly = moneyNumber(row && (row.weeklyAmount || row.weeklyAmountRaw));
  const plate = (vehicle && (vehicle.plate || vehicle.stock)) || row.licensePlate || row.tempTag || '';
  return {
    vehicleId: vehicle && vehicle.id || '',
    vehicle: vehicle ? vehicleNameFromParts(vehicle) : vehicleNameFromImport(row),
    vin: vehicle && vehicle.vin || row.vin || '',
    licensePlate: plate,
    plate,
    tempTag: vehicle && vehicle.tempTag || row.tempTag || '',
    tracker: vehicle && vehicle.tracker || row.tracker || '',
    amount: weekly || (vehicle && vehicle.rate) || 0,
    weeklyAmount: weekly || (vehicle && vehicle.rate) || 0
  };
}
function activeSheetRecord(row) {
  return !/removed|returned|ended|closed|history/i.test(String(row && (row.status || row.stage) || ''));
}
function rowClaimsVehicle(row, vehicle) {
  if (!row || !vehicle) return false;
  if (row.vehicleId && vehicle.id && row.vehicleId === vehicle.id) return true;
  if (row.vin && vehicle.vin && normKey(row.vin) === normKey(vehicle.vin)) return true;
  const rowPlate = row.licensePlate || row.plate || row.tag;
  const vehiclePlate = vehicle.plate || vehicle.stock;
  if (rowPlate && vehiclePlate && normKey(rowPlate) === normKey(vehiclePlate)) return true;
  return !!(row.vehicle && normKey(row.vehicle) === normKey(vehicleNameFromParts(vehicle)));
}
function clearWrongVehicleClaims(data, vehicle, customerName, reason) {
  const collections = [
    ['customers', 'name'],
    ['contracts', 'customer'],
    ['recurringPayments', 'customer']
  ];
  let cleared = 0;
  collections.forEach(([collectionName, customerField]) => {
    const rows = Array.isArray(data[collectionName]) ? data[collectionName] : [];
    rows.forEach(row => {
      const rowCustomer = row[customerField] || row.customer || row.name || '';
      if (!activeSheetRecord(row) || normKey(rowCustomer) === normKey(customerName) || !rowClaimsVehicle(row, vehicle)) return;
      row.previousVehicleId = row.vehicleId || row.previousVehicleId || '';
      row.previousVehicle = row.vehicle || row.previousVehicle || '';
      row.previousVin = row.vin || row.previousVin || '';
      row.previousPlate = row.licensePlate || row.plate || row.previousPlate || '';
      row.vehicleId = '';
      row.vehicle = '';
      row.vin = '';
      row.licensePlate = '';
      row.plate = '';
      row.tempTag = '';
      row.tracker = '';
      row.vehicleLinkStatus = 'Needs vehicle match';
      row.notes = [row.notes, reason].filter(Boolean).join('\n');
      row.updatedAt = new Date().toISOString();
      cleared += 1;
    });
  });
  const cloverRows = (((data.integrations || {}).clover || {}).recurringPlanMembers) || [];
  cloverRows.forEach(row => {
    const rowCustomer = row.customer || row.name || '';
    if (!activeSheetRecord(row) || normKey(rowCustomer) === normKey(customerName) || !rowClaimsVehicle(row, vehicle)) return;
    row.previousVehicleId = row.vehicleId || row.previousVehicleId || '';
    row.previousVehicle = row.vehicle || row.previousVehicle || '';
    row.previousVin = row.vin || row.previousVin || '';
    row.previousPlate = row.licensePlate || row.plate || row.previousPlate || '';
    row.vehicleId = '';
    row.vehicle = '';
    row.vin = '';
    row.licensePlate = '';
    row.plate = '';
    row.tempTag = '';
    row.tracker = '';
    row.vehicleLinkStatus = 'Needs vehicle match';
    row.notes = [row.notes, reason].filter(Boolean).join('\n');
    row.updatedAt = new Date().toISOString();
    cleared += 1;
  });
  return cleared;
}
function repairVehicleSheetLinkConflicts(data) {
  const rows = loadVehicleImportSync().filter(row => row && row.customer);
  if (!rows.length || !data) return 0;
  data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  data.contracts = Array.isArray(data.contracts) ? data.contracts : [];
  let repaired = 0;
  rows.forEach(row => {
    const vehicle = findVehicleForImportRow(data, row);
    if (!vehicle) return;
    const rowNumber = String(row.rowNumber || '').padStart(3, '0');
    const patch = importRowVehiclePatch(row, vehicle);
    const status = importVehicleStatus(row);
    const customerName = String(row.customer || '').trim();
    if (!vehicle.manuallyEditedAt && customerName && normKey(vehicle.currentCustomer) !== normKey(customerName)) {
      vehicle.currentCustomer = customerName;
      vehicle.status = status;
      vehicle.sourceRow = row.rowNumber;
      repaired += 1;
    }
    if (!vehicle.manuallyEditedAt && customerName) {
      repaired += clearWrongVehicleClaims(data, vehicle, customerName, 'Vehicle link cleared automatically because the vehicle sheet assigns this car to ' + customerName + '. Payment history was kept.');
    }
    const customer = data.customers.find(item => item.id === importRowId(row, 'cus-sheet-') || String(item.importedVehicleRow || '') === String(row.rowNumber));
    if (customer && String(customer.source || '').includes('Vehicle sheet import') && !customer.manuallyEditedAt) {
      const wantsPatch = customer.vehicleId !== patch.vehicleId || normKey(customer.vin) !== normKey(patch.vin) || normKey(customer.name || customer.customer) !== normKey(customerName);
      if (wantsPatch) {
        Object.assign(customer, {
          name: customerName,
          customer: customerName,
          stage: status === 'Rented' ? 'Active contract' : 'Vehicle history',
          status: status === 'Rented' ? 'Active' : 'History',
          tone: status === 'Rented' ? 'good' : 'warn',
          source: 'Vehicle sheet import',
          importedVehicleRow: row.rowNumber,
          dateStarted: row.dateStarted || customer.dateStarted || '',
          ...patch,
          weeklyAmount: patch.weeklyAmount || customer.weeklyAmount || 0,
          amount: patch.amount || customer.amount || 0,
          repairedAt: new Date().toISOString()
        });
        repaired += 1;
      }
    }
    const exactContract = data.contracts.find(item => item.id === importRowId(row, 'WOA-SHEET-'));
    if (exactContract && String(exactContract.source || '').includes('Vehicle sheet import') && activeSheetRecord(exactContract)) {
      const wantsPatch = exactContract.vehicleId !== patch.vehicleId || normKey(exactContract.vin) !== normKey(patch.vin) || normKey(exactContract.customer) !== normKey(customerName);
      if (wantsPatch) {
        Object.assign(exactContract, {
          customer: customerName,
          vehicle: patch.vehicle,
          vehicleId: patch.vehicleId,
          vin: patch.vin,
          licensePlate: patch.licensePlate,
          plate: patch.plate,
          tempTag: patch.tempTag,
          tracker: patch.tracker,
          weekly: patch.weeklyAmount || exactContract.weekly || 0,
          status: status === 'Rented' ? 'Active' : 'History',
          tone: status === 'Rented' ? 'good' : 'warn',
          dateStarted: row.dateStarted || exactContract.dateStarted || '',
          repairedAt: new Date().toISOString()
        });
        repaired += 1;
      }
      data.contracts.forEach(other => {
        if (other === exactContract || !activeSheetRecord(other)) return;
        if (!String(other.source || '').includes('Vehicle sheet import')) return;
        if (normKey(other.customer) === normKey(customerName) && (other.vehicleId === patch.vehicleId || normKey(other.vin) === normKey(patch.vin))) {
          other.status = 'Removed';
          other.tone = 'bad';
          other.duplicateOf = exactContract.id;
          other.removedAt = other.removedAt || new Date().toISOString();
          other.notes = [other.notes, 'Removed duplicate vehicle-sheet customer file after automatic link repair.'].filter(Boolean).join('\n');
          repaired += 1;
        }
      });
    }
  });
  if (repaired) {
    data.systemRepairs = data.systemRepairs || {};
    data.systemRepairs.vehicleSheetLinkRepairAt = new Date().toISOString();
    data.systemRepairs.vehicleSheetLinkRepairCount = (data.systemRepairs.vehicleSheetLinkRepairCount || 0) + repaired;
  }
  return repaired;
}
function ensureBaseOrganization(data) {
  if (!data) return data;
  data.organizations = Array.isArray(data.organizations) ? data.organizations : [];
  let main = data.organizations.find(org => org.id === MAIN_ORG_ID);
  if (!main) {
    main = {
      id: MAIN_ORG_ID,
      name: 'WheelsonAuto',
      type: 'Main company',
      status: 'Active',
      plan: 'Owner account',
      primaryAdmin: 'Khaled',
      dataScope: 'Global owner account',
      billingOwner: 'WheelsonAuto',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data.organizations.unshift(main);
  }
  data.staffAccounts = Array.isArray(data.staffAccounts) ? data.staffAccounts : [];
  data.customerAccounts = Array.isArray(data.customerAccounts) ? data.customerAccounts : [];
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  [...data.staffAccounts, ...data.customerAccounts].forEach(account => {
    if (!account.organizationId) account.organizationId = MAIN_ORG_ID;
  });
  return data;
}
function repairDataIds(data) {
  repairDuplicateVehicleIds(data);
  repairDuplicateRecordIds(data, 'contracts');
  ensureBaseOrganization(data);
  repairVehicleSheetLinkConflicts(data);
  resolveClaimCustomerLinks(data);
  return data;
}
function nextUniqueVehicleId(data, base, vehicle) {
  const ids = new Set((data.vehicles || []).map(row => String(row && row.id || '').trim()).filter(Boolean));
  if (!ids.has(base)) return base;
  let next = stableVehicleId(base, vehicle);
  let count = 2;
  while (ids.has(next)) {
    next = stableVehicleId(base + '-' + count, vehicle);
    count += 1;
  }
  return next;
}
function buildVehicleImportIndex(vehicles = []) {
  const byVin = new Map();
  const byPlate = new Map();
  const byTempTag = new Map();
  vehicles.forEach((vehicle, index) => {
    const vin = normKey(vehicle && vehicle.vin);
    const plate = normKey(vehicle && (vehicle.plate || vehicle.stock));
    const tempTag = normKey(vehicle && vehicle.tempTag);
    if (vin) byVin.set(vin, index);
    if (plate) byPlate.set(plate, index);
    if (tempTag) {
      const existing = byTempTag.get(tempTag);
      byTempTag.set(tempTag, existing === undefined ? index : null);
    }
  });
  return { byVin, byPlate, byTempTag };
}
function vehicleImportIndexMatch(indexes, row = {}) {
  const vin = normKey(row.vin);
  const plate = normKey(row.licensePlate);
  const tempTag = normKey(row.tempTag);
  if (vin && indexes.byVin.has(vin)) return indexes.byVin.get(vin);
  if (plate && indexes.byPlate.has(plate)) return indexes.byPlate.get(plate);
  if (tempTag && indexes.byTempTag.has(tempTag)) {
    const match = indexes.byTempTag.get(tempTag);
    if (match !== null) return match;
  }
  return -1;
}
function addVehicleImportIndexKeys(indexes, vehicle, index) {
  const vin = normKey(vehicle && vehicle.vin);
  const plate = normKey(vehicle && (vehicle.plate || vehicle.stock));
  const tempTag = normKey(vehicle && vehicle.tempTag);
  if (vin) indexes.byVin.set(vin, index);
  if (plate) indexes.byPlate.set(plate, index);
  if (tempTag) {
    const existing = indexes.byTempTag.get(tempTag);
    indexes.byTempTag.set(tempTag, existing === undefined ? index : null);
  }
}
async function readData() {
  try { return repairDataIds(JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))); }
  catch {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const seed = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
      await writeData(seed);
      return repairDataIds(seed);
    } catch {
      return { vehicles: [], applications: [], customers: [], contracts: [], payments: [], maintenance: [], claims: [], messages: [], messageTemplates: [], staffAccounts: [], customerAccounts: [], organizations: [], recurringPayments: [], tasks: [], documents: [], dailyCloseouts: [], websiteLeads: [], apiProviders: [], auditLogs: [], integrations: { clover: {}, shopify: {} } };
    }
  }
}
let writeDataQueue = Promise.resolve();
async function writeDataNow(data) {
  repairDataIds(data);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = DATA_FILE + '.' + process.pid + '.' + Date.now() + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpFile, DATA_FILE);
}
async function writeData(data) {
  const job = writeDataQueue.then(() => writeDataNow(data));
  writeDataQueue = job.catch(() => {});
  return job;
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
function compactKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}
function messageSettings(data = {}) {
  const saved = (((data.integrations || {}).messaging) || {});
  return {
    enabled: WOA_MESSAGING_ENABLED && saved.enabled !== false,
    aiEnabled: WOA_STAR_AI_ENABLED && saved.aiEnabled !== false,
    aiAutoSend: WOA_AI_AUTO_SEND && saved.aiAutoSend !== false,
    aiDrafts: WOA_AI_REPLY_DRAFTS && saved.aiDrafts !== false,
    emailEnabled: WOA_EMAIL_ENABLED && saved.emailEnabled !== false
  };
}
function emailNotificationSettings(data = {}) {
  const saved = (((data.integrations || {}).notifications) || {});
  const recipients = Array.isArray(saved.emailRecipients) ? saved.emailRecipients : String(saved.emailRecipients || saved.emailTo || '').split(',');
  return {
    emailEnabled: WOA_EMAIL_ENABLED && saved.emailEnabled !== false,
    emailRecipients: recipients.map(item => String(item || '').trim()).filter(Boolean),
    events: Array.isArray(saved.events) && saved.events.length ? saved.events : ['payment_failed', 'payment_not_found', 'application_submitted', 'maintenance_due', 'claim_dispute', 'daily_closeout', 'customer_password_reset', 'card_setup_completed', 'customer_message'],
    lastTestAt: saved.lastTestAt || '',
    lastError: saved.lastError || ''
  };
}
function emailProviderConfigured(provider) {
  const name = String(provider || WOA_EMAIL_PROVIDER || '').toLowerCase();
  if (!WOA_EMAIL_FROM) return false;
  if (name === 'resend') return !!RESEND_API_KEY;
  if (name === 'sendgrid') return !!SENDGRID_API_KEY;
  return false;
}
function publicMessagingStatus(data = {}) {
  const settings = messageSettings(data);
  const provider = MESSAGING_PROVIDER || 'not_configured';
  const emailIntegration = (((data.integrations || {}).email) || {});
  const emailProvider = String(emailIntegration.provider || WOA_EMAIL_PROVIDER || 'not_configured').toLowerCase();
  const emailConfigured = !!(settings.emailEnabled && (emailProviderConfigured(emailProvider) || emailIntegration.connected));
  const configured = !!(
    settings.enabled &&
    MESSAGING_FROM_NUMBER &&
    ((provider === 'twilio' && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) ||
      (provider === 'telnyx' && TELNYX_API_KEY))
  );
  return {
    provider,
    enabled: settings.enabled,
    configured,
    fromNumber: MESSAGING_FROM_NUMBER ? maskPhone(MESSAGING_FROM_NUMBER) : '',
    voiceMode: 'Keep calls on T-Mobile; hosted SMS/mirrored inbox connects here.',
    ownerMirror: MESSAGING_OWNER_NOTIFY_NUMBER ? maskPhone(MESSAGING_OWNER_NOTIFY_NUMBER) : '',
    webhookUrl: PUBLIC_BASE_URL + '/api/webhooks/messages',
    emailWebhookUrl: PUBLIC_BASE_URL + '/api/webhooks/email',
    aiProvider: OPENAI_API_KEY && WOA_AI_MODEL ? 'openai' : 'rules',
    aiEnabled: settings.aiEnabled,
    aiConfigured: !!(OPENAI_API_KEY && WOA_AI_MODEL),
    aiModel: WOA_AI_MODEL ? 'stored in Render' : '',
    aiName: 'Star AI',
    aiShortName: 'Star',
    aiAutoSend: settings.aiAutoSend,
    aiDrafts: settings.aiDrafts,
    emailEnabled: settings.emailEnabled,
    emailProvider,
    emailConfigured,
    emailFrom: emailConfigured ? 'stored in Render' : '',
    notificationEmail: settings.emailEnabled ? maskEmail(emailNotificationSettings(data).emailRecipients[0] || '') : '',
    notificationsEnabled: emailNotificationSettings(data).emailEnabled,
    emailMode: emailConfigured ? 'Email can send customer replies, receipts, approvals, documents, and follow-ups.' : 'Email channel is built in and will save drafts until an email provider is connected.',
    aiGuardrails: 'AI can answer normal texts/emails and send safe links. Charges, card changes, autopay edits, removals, disputes, receipts after payment, and unclear money requests require admin approval.'
  };
}
function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return value ? 'saved' : '';
  return '***-***-' + digits.slice(-4);
}
function maskEmail(value) {
  const text = String(value || '').trim();
  const parts = text.split('@');
  if (parts.length !== 2 || !parts[0]) return text ? 'saved' : '';
  return parts[0][0] + '***@' + parts[1];
}
function messageContactCandidates(data = {}) {
  const rows = [];
  (data.customers || []).forEach(row => rows.push({ name: row.name || row.customer || '', phone: row.phone || '', email: row.email || '', source: 'customer' }));
  (data.contracts || []).forEach(row => rows.push({ name: row.customer || row.name || '', phone: row.phone || '', email: row.email || '', source: 'customer file' }));
  (data.recurringPayments || []).forEach(row => rows.push({ name: row.customer || row.name || '', phone: row.phone || '', email: row.email || '', source: 'autopay' }));
  ((((data.integrations || {}).clover || {}).recurringPlanMembers) || []).forEach(row => rows.push({ name: row.customer || row.name || '', phone: row.phone || '', email: row.email || '', source: 'clover recurring' }));
  return rows.filter(row => row.name || row.phone || row.email);
}
function findMessageContact(data, payload = {}) {
  const phone = phoneKey(payload.phone || payload.from || payload.to || '');
  const email = emailKey(payload.email || '');
  const name = normKey(payload.customer || payload.name || '');
  const contacts = messageContactCandidates(data);
  if (phone) {
    const match = contacts.find(row => phoneKey(row.phone) === phone);
    if (match) return match;
  }
  if (email) {
    const match = contacts.find(row => emailKey(row.email) === email);
    if (match) return match;
  }
  if (name) {
    const match = contacts.find(row => softNameMatch(row.name, name));
    if (match) return match;
  }
  return { name: payload.customer || payload.name || '', phone: payload.phone || payload.from || '', email: payload.email || '', source: '' };
}
function cleanPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return String(value || '').trim();
}
function parseIncomingMessage(provider, headers, payload) {
  const body = payload || {};
  const event = body.data && body.data.payload ? body.data.payload : body;
  const fromObj = event.from || body.From || body.from || {};
  const toObj = event.to || body.To || body.to || {};
  return {
    provider: provider || body.provider || MESSAGING_PROVIDER || 'webhook',
    from: typeof fromObj === 'object' ? (fromObj.phone_number || fromObj.number || '') : fromObj,
    to: Array.isArray(toObj) ? (toObj[0] && (toObj[0].phone_number || toObj[0].number) || '') : (typeof toObj === 'object' ? (toObj.phone_number || toObj.number || '') : toObj),
    body: event.text || event.body || body.Body || body.body || body.message || '',
    externalId: event.id || body.MessageSid || body.SmsSid || body.messageSid || body.id || '',
    media: event.media || body.MediaUrl0 || '',
    rawType: body.EventType || body.event_type || body.type || 'message.received'
  };
}
function parseEmailAddress(value) {
  if (!value) return '';
  if (Array.isArray(value)) return parseEmailAddress(value[0]);
  if (typeof value === 'object') return value.email || value.address || value.mail || '';
  const text = String(value || '').trim();
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : text;
}
function parseIncomingEmail(provider, headers, payload) {
  const body = payload || {};
  const event = body.data || body.event || body;
  const from = parseEmailAddress(event.from || body.from || body.From || event.sender || event.reply_to || event.replyTo);
  const to = parseEmailAddress(event.to || body.to || body.To || event.recipient || event.recipients);
  const textBody = event.text || event.text_body || event.body || body.text || body.body || body.TextBody || '';
  const htmlBody = event.html || event.html_body || body.html || body.HtmlBody || '';
  return {
    provider: provider || body.provider || WOA_EMAIL_PROVIDER || 'email_webhook',
    from,
    to,
    subject: event.subject || body.subject || body.Subject || 'Incoming email',
    body: String(textBody || htmlBody || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    externalId: event.id || body.id || body.message_id || body.MessageID || body.sg_message_id || headers['x-message-id'] || '',
    rawType: body.type || body.event || 'email.received'
  };
}
async function sendProviderSms(to, body, meta = {}) {
  const provider = MESSAGING_PROVIDER;
  if (!body) throw new Error('Message needs a message body.');
  if (!to) return { sent: false, status: 'Needs phone', provider: provider || 'not_configured', message: 'Add the customer phone number before sending.' };
  const settings = meta.messagingSettings || { enabled: WOA_MESSAGING_ENABLED };
  if (!settings.enabled) return { sent: false, status: 'Messaging off', provider: provider || 'not_configured', message: 'Messaging is turned off in WheelsonAuto settings or Render.' };
  if (!MESSAGING_FROM_NUMBER) return { sent: false, status: 'Ready to send', provider: provider || 'not_configured', message: 'Add the hosted SMS number in Render first.' };
  if (provider === 'twilio' && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    const form = new URLSearchParams({ From: MESSAGING_FROM_NUMBER, To: cleanPhone(to), Body: body });
    const auth = Buffer.from(TWILIO_ACCOUNT_SID + ':' + TWILIO_AUTH_TOKEN).toString('base64');
    const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(TWILIO_ACCOUNT_SID) + '/Messages.json', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const jsonBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(jsonBody.message || 'Twilio message failed.');
    return { sent: true, status: jsonBody.status || 'Sent', provider: 'twilio', externalId: jsonBody.sid || '', response: jsonBody };
  }
  if (provider === 'telnyx' && TELNYX_API_KEY) {
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TELNYX_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MESSAGING_FROM_NUMBER, to: cleanPhone(to), text: body, messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID || undefined })
    });
    const jsonBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((jsonBody.errors && jsonBody.errors[0] && jsonBody.errors[0].detail) || jsonBody.message || 'Telnyx message failed.');
    return { sent: true, status: (jsonBody.data && jsonBody.data.record_type) || 'Queued', provider: 'telnyx', externalId: jsonBody.data && jsonBody.data.id || '', response: jsonBody };
  }
  return { sent: false, status: 'Ready to send', provider: provider || 'not_configured', message: 'Hosted SMS is not connected yet. Message saved in WheelsonAuto.' };
}
async function sendProviderEmail(to, subject, body, meta = {}) {
  const provider = String(WOA_EMAIL_PROVIDER || 'not_configured').toLowerCase();
  if (!body) throw new Error('Email needs a message body.');
  if (!to) return { sent: false, status: 'Needs email', provider, channel: 'Email', message: 'Add the customer email before sending.' };
  const settings = meta.messagingSettings || { emailEnabled: WOA_EMAIL_ENABLED };
  if (!settings.emailEnabled) return { sent: false, status: 'Email off', provider, channel: 'Email', message: 'Email messaging is turned off in WheelsonAuto settings or Render.' };
  if (!WOA_EMAIL_FROM) return { sent: false, status: 'Email draft', provider, channel: 'Email', message: 'Add WOA_EMAIL_FROM in Render before live email sending.' };
  const safeSubject = String(subject || 'WheelsonAuto message').trim().slice(0, 180) || 'WheelsonAuto message';
  if (provider === 'resend' && RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: WOA_EMAIL_FROM, to: [String(to).trim()], subject: safeSubject, text: body })
    });
    const jsonBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(jsonBody.message || jsonBody.error || 'Resend email failed.');
    return { sent: true, status: 'Sent', provider: 'resend', channel: 'Email', externalId: jsonBody.id || '', response: jsonBody };
  }
  if (provider === 'sendgrid' && SENDGRID_API_KEY) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + SENDGRID_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: String(to).trim() }] }],
        from: { email: WOA_EMAIL_FROM },
        subject: safeSubject,
        content: [{ type: 'text/plain', value: body }]
      })
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new Error(text || 'SendGrid email failed.');
    return { sent: true, status: 'Sent', provider: 'sendgrid', channel: 'Email', externalId: response.headers.get('x-message-id') || '', response: text };
  }
  return { sent: false, status: 'Email draft', provider, channel: 'Email', message: 'Email provider is not connected yet. Email saved in WheelsonAuto.' };
}
async function queueEmailNotification(data, payload = {}) {
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  data.integrations = data.integrations || {};
  data.integrations.notifications = data.integrations.notifications || {};
  const settings = emailNotificationSettings(data);
  const to = String(payload.to || settings.emailRecipients[0] || '').trim();
  const subject = String(payload.subject || 'WheelsonAuto notification').trim();
  const body = String(payload.body || 'WheelsonAuto notification test.').trim();
  const event = String(payload.event || 'manual_test').trim();
  const customer = String(payload.customer || 'WheelsonAuto').trim();
  let result;
  try {
    result = await sendProviderEmail(to, subject, body, { customer, messagingSettings: { emailEnabled: settings.emailEnabled } });
  } catch (err) {
    result = { sent: false, status: 'Email failed', provider: WOA_EMAIL_PROVIDER || 'not_configured', channel: 'Email', message: String(err && err.message || err) };
  }
  const record = {
    id: 'msg-notify-' + Date.now(),
    externalId: result.externalId || '',
    date: new Date().toLocaleString('en-US'),
    createdAt: new Date().toISOString(),
    customer,
    email: to,
    to,
    direction: 'Outbound notification',
    channel: 'Email',
    template: payload.template || 'Notification',
    subject,
    status: result.sent ? (result.status || 'Sent') : (result.status || 'Email draft'),
    tone: result.sent ? 'good' : 'warn',
    body,
    provider: result.provider || WOA_EMAIL_PROVIDER || 'not_configured',
    source: 'WheelsonAuto email notification',
    event
  };
  data.messages.unshift(record);
  data.integrations.notifications.emailEnabled = settings.emailEnabled;
  data.integrations.notifications.emailRecipients = settings.emailRecipients;
  data.integrations.notifications.lastNotificationAt = new Date().toISOString();
  data.integrations.notifications.lastNotificationEvent = event;
  if (event === 'manual_test') data.integrations.notifications.lastTestAt = data.integrations.notifications.lastNotificationAt;
  data.integrations.notifications.lastStatus = record.status;
  data.integrations.notifications.lastError = result.sent ? '' : (result.message || '');
  return { sent: !!result.sent, result, message: record };
}
async function queueOwnerEmailNotification(data, event, payload = {}) {
  const settings = emailNotificationSettings(data);
  if (!settings.emailEnabled || !settings.emailRecipients.length) return null;
  if (settings.events.length && !settings.events.includes(event)) return null;
  return queueEmailNotification(data, { ...payload, event });
}
function recordDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/today/i.test(raw)) return localDateKey();
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : dateKey(parsed);
}
function closeoutPaymentPaid(payment = {}) {
  const status = String(payment.status || '').toLowerCase();
  const meta = String([payment.method, payment.type, payment.source, payment.notes, payment.message, payment.error].filter(Boolean).join(' ')).toLowerCase();
  const paidOutside = status.includes('paid outside app') && !status.includes('rejected');
  const paid = status === 'paid' || paidOutside;
  return paid && !/(refund|void|chargeback|dispute|failed|not found|rejected)/.test(meta + ' ' + status) && Number(payment.amount || 0) > 0;
}
function closeoutPaymentOutsideApp(payment = {}) {
  const status = String(payment.status || '').toLowerCase();
  const meta = String([payment.method, payment.type, payment.source, payment.notes, payment.message].filter(Boolean).join(' ')).toLowerCase();
  return (status.includes('paid outside app') || /(paid outside app|cash|zelle|cash app|money order)/.test(meta)) && closeoutPaymentPaid(payment);
}
function weakCloseoutCustomerName(value) {
  const raw = String(value || '').trim();
  return !raw || /^(clover payment|unmatched clover payment|unknown customer|customer match needed|debit card|credit card|customer)$/i.test(raw);
}
function closeoutDescriptionCustomer(payment = {}) {
  const text = String(payment.description || payment.notes || payment.memo || '').trim();
  const match = text.match(/WheelsonAuto\s+.*?payment\s+-\s+(.+)$/i);
  return match && !weakCloseoutCustomerName(match[1]) ? match[1].trim() : '';
}
function closeoutPaymentIds(payment = {}) {
  return [
    payment.cloverPaymentId,
    payment.cloverChargeId,
    payment.paymentId,
    payment.externalPaymentId,
    payment.chargeId,
    payment.id
  ].map(value => String(value || '').trim().replace(/^clover-payment-/i, '').replace(/^clover-manual-charge-/i, '')).filter(Boolean);
}
function closeoutPaymentKey(payment = {}) {
  const external = String(payment.externalReferenceId || payment.external_reference_id || payment.external_reference || payment.paymentRequestId || '').trim();
  if (external) return external;
  const ids = closeoutPaymentIds(payment);
  if (ids.length) return ids[0];
  return [
    recordDateKey(payment.date || payment.createdAt),
    normKey(payment.customer),
    Number(payment.amount || 0),
    String(payment.method || payment.type || ''),
    String(payment.source || ''),
    String(payment.status || '')
  ].join('|');
}
function closeoutUsefulCustomerName(payment = {}) {
  const raw = String(payment.customer || '').trim();
  if (!weakCloseoutCustomerName(raw)) return raw;
  const described = closeoutDescriptionCustomer(payment);
  if (described) return described;
  const external = String(payment.externalCustomerReference || '').trim();
  if (external && /\s/.test(external) && !weakCloseoutCustomerName(external)) return external;
  return '';
}
function uniqueCloseoutPayments(rows = []) {
  const byKey = new Map();
  const order = [];
  rows.forEach(payment => {
    const key = closeoutPaymentKey(payment);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, payment);
      order.push(key);
      return;
    }
    const old = byKey.get(key);
    const oldName = closeoutUsefulCustomerName(old);
    const newName = closeoutUsefulCustomerName(payment);
    const merged = { ...old, ...payment };
    if (oldName && !newName) merged.customer = oldName;
    if (newName) merged.customer = newName;
    ['phone', 'email', 'vehicle', 'vehicleId', 'vin', 'licensePlate', 'plate', 'tempTag', 'tracker', 'recurringPaymentId', 'cloverCustomerId', 'cloverSubscriptionId', 'externalReferenceId', 'externalCustomerReference'].forEach(field => {
      if (!merged[field] && old[field]) merged[field] = old[field];
    });
    byKey.set(key, merged);
  });
  return order.map(key => byKey.get(key));
}
function closeoutPaymentCustomerName(data, payment = {}, recurringRows = allRecurringRows(data)) {
  const useful = closeoutUsefulCustomerName(payment);
  if (useful) return useful;
  const ids = [payment.recurringPaymentId, payment.recurringId, payment.cloverSubscriptionId, payment.subscriptionId].filter(Boolean).map(String);
  let recurring = recurringRows.find(row => ids.includes(String(row.id || '')) || ids.includes(String(row.cloverSubscriptionId || '')));
  if (!recurring) {
    const cloverCustomerId = String(payment.cloverCustomerId || payment.customerId || '').trim();
    if (cloverCustomerId) recurring = recurringRows.find(row => String(row.cloverCustomerId || '') === cloverCustomerId);
  }
  if (!recurring) {
    const externalCustomer = String(payment.externalCustomerReference || '').trim();
    if (externalCustomer) recurring = recurringRows.find(row => String(row.cloverCustomerId || '') === externalCustomer || normKey(row.customer) === normKey(externalCustomer));
  }
  if (!recurring && payment.paymentRequestId) {
    const request = (data.paymentRequests || []).find(row => row.id === payment.paymentRequestId);
    if (request && request.customer) return request.customer;
    if (request && request.recurringPaymentId) recurring = recurringRows.find(row => row.id === request.recurringPaymentId);
  }
  if (!recurring && payment.email) recurring = recurringRows.find(row => emailKey(row.email) === emailKey(payment.email));
  if (!recurring && payment.phone) recurring = recurringRows.find(row => phoneKey(row.phone) === phoneKey(payment.phone));
  if (!recurring && payment.vehicle) recurring = recurringRows.find(row => normKey(row.vehicle) === normKey(payment.vehicle));
  if (!recurring && Number(payment.amount)) {
    const sameAmount = recurringRows.filter(row => Number(row.amount || row.weeklyAmount || 0) === Number(payment.amount || 0));
    if (sameAmount.length === 1) recurring = sameAmount[0];
  }
  return recurring && recurring.customer ? recurring.customer : 'Unmatched payment';
}
function closeoutRecurringState(row = {}, dateKeyValue = localDateKey()) {
  const text = String([row.status, row.tone, row.lastAutoChargeResult, row.lastAutoChargeError].filter(Boolean).join(' ')).toLowerCase();
  const failedAttempts = Math.max(Number(row.retryCount || 0), Number(row.failedAttempts || 0));
  if (String(row.lastAutoChargeDate || '') === dateKeyValue) return 'Paid';
  if (text.includes('removed') || text.includes('history') || text.includes('returned')) return 'History / removed';
  if (text.includes('not found')) return 'Payment not found';
  if (failedAttempts >= 2 || text.includes('2x') || text.includes('contact')) return 'Failed twice';
  if (failedAttempts === 1 || text.includes('1x') || text.includes('retry')) return 'Failed once';
  if (text.includes('setup') || text.includes('waiting') || text.includes('pending')) return 'Setup needed';
  if (closeoutRecurringChargeable(row)) return 'Chargeable';
  if (closeoutRecurringCardLinked(row)) return 'Card linked';
  return 'Pending today';
}
function closeoutRecurringCardLinked(row = {}) {
  const text = String([row.paymentSetup, row.cardLabel, row.cardLast4, row.cardSavedAt, row.cloverPaymentSource].filter(Boolean).join(' ')).toLowerCase();
  return !!recurringPaymentSource(row) || !!String(row.cardLast4 || '').trim() || text.includes('card linked') || text.includes('saved card') || text.includes('card saved');
}
function closeoutRecurringChargeable(row = {}) {
  const text = String([row.status, row.paymentSetup, row.lastAutoChargeError, row.notes].filter(Boolean).join(' ')).toLowerCase();
  if (text.includes('removed') || text.includes('history') || text.includes('returned') || text.includes('setup') || text.includes('not found') || text.includes('waiting')) return false;
  return !!recurringPaymentSource(row);
}
function closeoutVerificationItems(data = {}) {
  const items = [];
  (data.documents || []).filter(row => {
    const status = String(row.status || '').toLowerCase();
    return row.requiresVerification === true || status.includes('need') || status.includes('review') || status.includes('pending');
  }).forEach(row => {
    items.push({
      type: 'Document proof',
      customer: row.customer || 'Unassigned',
      detail: [row.type || 'Document', row.vehicle || '', row.reference || row.policyNumber || '', row.proofUrl || row.url || ''].filter(Boolean).join(' | ')
    });
  });
  (data.payments || []).filter(row => {
    const status = String(row.status || '').toLowerCase();
    return row.requiresVerification === true || status.includes('needs verification');
  }).forEach(row => {
    items.push({
      type: 'Paid outside app',
      customer: closeoutUsefulCustomerName(row) || row.customer || 'Unassigned',
      detail: [moneyText(row.amount || 0), row.date || row.createdAt || '', row.method || row.type || '', row.notes || ''].filter(Boolean).join(' | ')
    });
  });
  (data.maintenance || []).filter(row => String(row.source || '').toLowerCase().includes('customer portal') && (row.proofUrl || row.url || row.evidence)).forEach(row => {
    items.push({
      type: 'Service proof',
      customer: row.customer || 'Unassigned',
      detail: [row.type || row.issue || 'Service', row.vehicle || '', row.due || row.nextDue || '', row.proofUrl || row.url || row.evidence || ''].filter(Boolean).join(' | ')
    });
  });
  (data.claims || []).filter(row => String(row.source || '').toLowerCase().includes('customer portal') && (row.proofUrl || row.url || row.evidence)).forEach(row => {
    items.push({
      type: 'Claim / toll proof',
      customer: row.customer || 'Unassigned',
      detail: [row.type || 'Issue', moneyText(row.amount || 0), row.incidentDate || row.nextFollowUp || '', row.proofUrl || row.url || row.evidence || ''].filter(Boolean).join(' | ')
    });
  });
  return items.slice(0, 30);
}
function verificationText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}
function documentVerificationPatch(payload = {}, existing = {}) {
  const patch = {};
  [
    'type', 'customer', 'vehicle', 'vehicleId', 'vin', 'licensePlate', 'plate', 'tempTag', 'tracker',
    'provider', 'agency', 'policyNumber', 'reference', 'expires', 'due', 'url', 'proofUrl',
    'visibility', 'notes', 'internalNotes'
  ].forEach(field => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) patch[field] = verificationText(payload[field], field === 'notes' || field === 'internalNotes' ? 1200 : 500);
  });
  if (patch.proofUrl && !patch.url) patch.url = patch.proofUrl;
  if (patch.url && !patch.proofUrl && !existing.proofUrl) patch.proofUrl = patch.url;
  return patch;
}
function addVerificationMessage(data, row = {}) {
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  data.messages.unshift({
    id: 'msg-proof-review-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    date: new Date().toLocaleString('en-US'),
    createdAt: new Date().toISOString(),
    organizationId: row.organizationId || MAIN_ORG_ID,
    customer: row.customer || 'Unassigned',
    phone: row.phone || '',
    email: row.email || '',
    direction: 'Internal log',
    channel: 'Verification',
    template: row.template || 'Proof review',
    subject: row.subject || 'Proof review',
    status: row.status || 'Reviewed',
    tone: row.tone || (String(row.status || '').toLowerCase().includes('reject') ? 'bad' : 'good'),
    body: row.body || '',
    source: 'WheelsonAuto verification',
    paymentId: row.paymentId || '',
    documentId: row.documentId || '',
    vehicleId: row.vehicleId || ''
  });
}
function reviewDocumentProof(data, user, payload = {}) {
  const id = verificationText(payload.documentId || payload.id, 160);
  data.documents = Array.isArray(data.documents) ? data.documents : [];
  const document = data.documents.find(row => row.id === id);
  if (!id || !document) {
    const error = new Error('Document proof was not found.');
    error.status = 404;
    throw error;
  }
  if (document.system) {
    const error = new Error('Generated documents must be reviewed from their source record.');
    error.status = 409;
    throw error;
  }
  Object.assign(document, documentVerificationPatch(payload, document));
  const approved = verificationText(payload.action || payload.decision).toLowerCase() !== 'reject';
  const reviewer = user && (user.name || user.username || user.role) || 'WheelsonAuto';
  const reviewDate = localDateKey();
  document.status = approved ? 'Verified' : 'Rejected';
  document.requiresVerification = false;
  document.tone = approved ? 'good' : 'bad';
  document.verifiedBy = reviewer;
  document.verifiedAt = reviewDate;
  document.reviewedAt = new Date().toISOString();
  document.reviewedBy = reviewer;
  document.visibility = document.customer ? 'Customer visible' : (document.visibility || 'Staff only');
  document.customerVisible = !!document.customer;
  document.portalVisible = !!document.customer;
  document.internalNotes = [
    document.internalNotes || '',
    approved ? 'Staff verified document proof.' : 'Staff rejected document proof; customer follow-up needed.'
  ].filter(Boolean).join(' | ');
  addVerificationMessage(data, {
    organizationId: document.organizationId,
    customer: document.customer,
    documentId: document.id,
    vehicleId: document.vehicleId,
    template: approved ? 'Document verified' : 'Document rejected',
    subject: approved ? 'Document proof verified' : 'Document proof rejected',
    status: document.status,
    tone: document.tone,
    body: [document.type || 'Document', document.provider || document.reference || '', document.vehicle || '', document.vin ? 'VIN: ' + document.vin : '', document.plate || document.licensePlate ? 'Tag: ' + (document.plate || document.licensePlate) : '', document.proofUrl || document.url ? 'Proof: ' + (document.proofUrl || document.url) : ''].filter(Boolean).join('\n')
  });
  return document;
}
function reviewPaidOutsideProof(data, user, payload = {}) {
  const id = verificationText(payload.paymentId || payload.id, 160);
  data.payments = Array.isArray(data.payments) ? data.payments : [];
  const payment = data.payments.find(row => row.id === id);
  if (!id || !payment) {
    const error = new Error('Paid-outside report was not found.');
    error.status = 404;
    throw error;
  }
  const approved = verificationText(payload.action || payload.decision).toLowerCase() !== 'reject';
  const reviewer = user && (user.name || user.username || user.role) || 'WheelsonAuto';
  const reviewDate = localDateKey();
  payment.requiresVerification = false;
  payment.verifiedBy = reviewer;
  payment.verifiedAt = reviewDate;
  payment.reviewedAt = new Date().toISOString();
  payment.status = approved ? 'Paid outside app' : 'Paid outside app rejected';
  payment.tone = approved ? 'good' : 'bad';
  payment.notes = [
    payment.notes || '',
    (approved ? 'Verified by ' : 'Rejected by ') + reviewer + ' on ' + reviewDate,
    verificationText(payload.note, 500)
  ].filter(Boolean).join(' | ');
  addVerificationMessage(data, {
    organizationId: payment.organizationId,
    customer: payment.customer,
    phone: payment.phone,
    email: payment.email,
    paymentId: payment.id,
    vehicleId: payment.vehicleId,
    template: approved ? 'Paid-outside verified' : 'Paid-outside rejected',
    subject: approved ? 'Paid-outside payment verified' : 'Paid-outside payment rejected',
    status: payment.status,
    tone: payment.tone,
    body: [moneyText(payment.amount || 0), payment.method || payment.type || 'Payment', payment.vehicle || '', payment.vin ? 'VIN: ' + payment.vin : '', payment.licensePlate || payment.plate ? 'Tag: ' + (payment.licensePlate || payment.plate) : '', payment.proofUrl || payment.url ? 'Proof: ' + (payment.proofUrl || payment.url) : ''].filter(Boolean).join('\n')
  });
  return payment;
}
function dailyCloseoutNotificationPayload(data, dateKeyValue = localDateKey(), ownerNote = '') {
  const recurring = allRecurringRows(data).filter(row => {
    if (!row) return false;
    return recurringDateKey(row) === dateKeyValue || String(row.lastAutoChargeDate || row.lastAutoChargeAttemptDate || '') === dateKeyValue || /fail|not found|retry|contact/i.test(String(row.status || ''));
  });
  const payments = uniqueCloseoutPayments((data.payments || []).filter(payment => recordDateKey(payment.date || payment.createdAt) === dateKeyValue));
  const paidPayments = payments.filter(closeoutPaymentPaid);
  const paidOutsidePayments = paidPayments.filter(closeoutPaymentOutsideApp);
  const cloverPayments = paidPayments.filter(payment => /clover/i.test(String([payment.source, payment.method, payment.type, payment.notes].filter(Boolean).join(' '))) && !closeoutPaymentOutsideApp(payment));
  const paidOutsideAmount = paidOutsidePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const cloverCollected = cloverPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const expected = recurring.reduce((sum, row) => sum + Number(row.amount || row.weeklyAmount || 0), 0);
  const collected = paidPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const recurringWithState = recurring.map(row => ({ row, state: closeoutRecurringState(row, dateKeyValue) }));
  const failedOnce = recurringWithState.filter(item => item.state === 'Failed once').map(item => item.row);
  const failedTwice = recurringWithState.filter(item => item.state === 'Failed twice').map(item => item.row);
  const paymentNotFound = recurringWithState.filter(item => item.state === 'Payment not found').map(item => item.row);
  const setupNeeded = recurringWithState.filter(item => item.state === 'Setup needed').map(item => item.row);
  const chargeable = recurringWithState.filter(item => item.state === 'Chargeable').map(item => item.row);
  const cardLinked = recurringWithState.filter(item => item.state === 'Card linked').map(item => item.row);
  const pendingToday = recurringWithState.filter(item => item.state === 'Pending today').map(item => item.row);
  const failed = failedOnce.concat(failedTwice).concat(paymentNotFound);
  const pending = pendingToday.concat(chargeable).concat(cardLinked).concat(setupNeeded).concat(paymentNotFound);
  const stillOpenAmount = Math.max(0, expected - collected);
  const peopleToContact = failedTwice.length + paymentNotFound.length;
  const verificationItems = closeoutVerificationItems(data);
  const auditEvents = (data.auditLogs || []).filter(row => recordDateKey(row.at || row.date || row.createdAt) === dateKeyValue).slice(0, 12);
  const savedNote = (data.dailyCloseouts || []).find(row => row.dateKey === dateKeyValue);
  const closeoutNote = String(ownerNote || savedNote && savedNote.note || '').trim();
  const lines = [
    'WheelsonAuto daily closeout for ' + dateKeyValue,
    '',
    'Expected from due/active tracked customers: ' + moneyText(expected),
    'Collected in recorded paid transactions: ' + moneyText(collected),
    'Still open amount: ' + moneyText(stillOpenAmount),
    'Pending today: ' + pendingToday.length,
    'Chargeable or card linked: ' + (chargeable.length + cardLinked.length),
    'Setup needed: ' + setupNeeded.length,
    'Payment not found: ' + paymentNotFound.length,
    'Failed once / retry watch: ' + failedOnce.length,
    'Failed twice / contact now: ' + failedTwice.length,
    'Paid outside app: ' + paidOutsidePayments.length + ' / ' + moneyText(paidOutsideAmount),
    'Clover collected: ' + moneyText(cloverCollected),
    'Today transactions recorded: ' + payments.length,
    'People to contact: ' + peopleToContact,
    'Verification inbox waiting: ' + verificationItems.length,
    ...(closeoutNote ? ['', 'Owner note:', closeoutNote] : []),
    '',
    'Customers to review:',
    ...(recurring.length ? recurring.slice(0, 20).map(row => '- ' + (row.customer || 'Unknown customer') + ' | ' + moneyText(row.amount || row.weeklyAmount || 0) + ' | ' + closeoutRecurringState(row, dateKeyValue) + ' | ' + (row.vehicle || row.vin || 'No vehicle linked')) : ['- No due/failed customers in closeout.']),
    '',
    'Recent transactions:',
    ...(payments.length ? payments.slice(0, 20).map(payment => '- ' + closeoutPaymentCustomerName(data, payment, recurring) + ' | ' + moneyText(payment.amount || 0) + ' | ' + (payment.status || 'Recorded') + ' | ' + (payment.method || payment.type || payment.source || 'Payment')) : ['- No transactions recorded today.']),
    '',
    'Verification inbox:',
    ...(verificationItems.length ? verificationItems.slice(0, 20).map(item => '- ' + item.type + ' | ' + item.customer + ' | ' + item.detail) : ['- No customer proof, paid-outside, service, toll, claim, or document review items waiting.']),
    '',
    'Sensitive changes today:',
    ...(auditEvents.length ? auditEvents.map(row => '- ' + (row.action || 'Audit') + ' | ' + (row.user || 'Unknown') + ' | ' + (row.details || 'No detail')) : ['- No owner/staff changes recorded today.'])
  ];
  return {
    customer: 'WheelsonAuto',
    subject: 'WheelsonAuto daily closeout - ' + dateKeyValue,
    body: lines.join('\n'),
    template: 'Daily closeout',
    summary: {
      dateKey: dateKeyValue,
      expected,
      collected,
      stillOpenAmount,
      pending: pending.length,
      failed: failed.length,
      pendingToday: pendingToday.length,
      chargeable: chargeable.length,
      cardLinked: cardLinked.length,
      setupNeeded: setupNeeded.length,
      paymentNotFound: paymentNotFound.length,
      failedOnce: failedOnce.length,
      failedTwice: failedTwice.length,
      peopleToContact,
      paidOutsideApp: paidOutsidePayments.length,
      paidOutsideAmount,
      cloverCollected,
      cloverTransactions: cloverPayments.length,
      paidTransactions: paidPayments.length,
      transactions: payments.length,
      verificationItems: verificationItems.length,
      auditEvents: auditEvents.length,
      ownerNote: closeoutNote
    }
  };
}
function reportCsvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}
function reportCsvNote(parts = []) {
  return parts.filter(Boolean).map(value => String(value || '').trim()).filter(Boolean).join(' | ');
}
function addReportRow(rows, section, date, customer, vehicle, vin, tag, tracker, type, amount, status, source, notes) {
  rows.push([section || '', date || '', customer || '', vehicle || '', vin || '', tag || '', tracker || '', type || '', amount || 0, status || '', source || '', notes || '']);
}
function reportVehicleFor(data = {}, customerName = '', vehicleId = '') {
  const vehicleKey = String(vehicleId || '').trim();
  if (vehicleKey) {
    const byId = (data.vehicles || []).find(row => row.id === vehicleKey);
    if (byId) return byId;
  }
  const nameKey = normKey(customerName);
  if (nameKey) {
    const assigned = (data.vehicles || []).find(row => normKey(row.currentCustomer || row.customer) === nameKey);
    if (assigned) return assigned;
  }
  const profile = (data.customers || []).find(row => normKey(row.name || row.customer) === nameKey) || (data.contracts || []).find(row => normKey(row.customer || row.name) === nameKey) || {};
  if (profile.vehicleId) {
    const byProfileId = (data.vehicles || []).find(row => row.id === profile.vehicleId);
    if (byProfileId) return byProfileId;
  }
  const profileVehicle = normKey(profile.vehicle);
  return profileVehicle ? ((data.vehicles || []).find(row => normKey(vehicleNameFromParts(row)) === profileVehicle || normKey(row.name) === profileVehicle) || {}) : {};
}
function reportDocumentClearedForCustomer(data = {}, name = '', kind = '') {
  const key = normKey(name);
  const docKind = String(kind || '').toLowerCase();
  if (!key || !docKind) return false;
  return (data.documents || []).some(row => {
    const customerKey = normKey(row.customer || row.name);
    const text = String([row.type, row.kind, row.title, row.provider, row.reference, row.notes].filter(Boolean).join(' ')).toLowerCase();
    const status = String(row.status || '').toLowerCase();
    return customerKey === key && text.includes(docKind) && (status.includes('verified') || status.includes('active') || row.requiresVerification === false);
  });
}
function reportCustomerRisk(data = {}, name = '', recurring = {}, vehicle = {}) {
  const key = normKey(name);
  const customer = (data.customers || []).find(row => normKey(row.name || row.customer) === key) || {};
  const contract = (data.contracts || []).find(row => normKey(row.customer || row.name) === key) || {};
  const issues = [];
  if (!String(customer.phone || contract.phone || recurring.phone || '').trim()) issues.push('Missing phone');
  if (!String(customer.email || contract.email || recurring.email || '').trim()) issues.push('Missing email');
  if (!vehicle.id && !recurring.vehicle && !customer.vehicle && !contract.vehicle) issues.push('No vehicle linked');
  if ((vehicle.id || recurring.vehicle || customer.vehicle || contract.vehicle) && !String(vehicle.vin || recurring.vin || customer.vin || contract.vin || '').trim()) issues.push('Missing VIN');
  if ((vehicle.id || recurring.vehicle || customer.vehicle || contract.vehicle) && !String(vehicle.plate || vehicle.stock || recurring.licensePlate || recurring.plate || customer.licensePlate || contract.licensePlate || '').trim()) issues.push('Missing tag/plate');
  if (name && !reportDocumentClearedForCustomer(data, name, 'insurance')) issues.push('Insurance proof not verified');
  if (name && !reportDocumentClearedForCustomer(data, name, 'background')) issues.push('Background check not verified');
  const status = closeoutRecurringState(recurring || {});
  if (['Failed once', 'Failed twice', 'Payment not found', 'Setup needed'].includes(status)) issues.push(status);
  return issues.join(' | ') || 'Clean';
}
function reportClaimCandidateNote(claim = {}) {
  return (claim.matchCandidates || []).slice(0, 3).map(candidate => {
    return [
      'Possible match ' + (candidate.customer || 'customer'),
      candidate.vehicle || '',
      candidate.vin ? 'VIN ' + candidate.vin : '',
      candidate.plate ? 'Tag ' + candidate.plate : '',
      candidate.tracker ? 'Tracker ' + candidate.tracker : '',
      candidate.matchReason || ''
    ].filter(Boolean).join(' / ');
  }).join(' || ');
}
function closeoutPaymentPossibleMatches(data = {}, payment = {}, recurringRows = allRecurringRows(data)) {
  const amount = Number(payment.amount || 0);
  const date = recordDateKey(payment.date || payment.createdAt);
  const ids = closeoutPaymentIds(payment);
  const seen = new Set();
  const matches = [];
  function add(row, reasons, score) {
    if (!row || !row.customer) return;
    const key = normKey(row.customer);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const vehicle = reportVehicleFor(data, row.customer, row.vehicleId);
    const tag = vehicle.plate || vehicle.stock || row.licensePlate || row.plate || '';
    matches.push({
      customer: row.customer,
      amount: Number(row.amount || row.weeklyAmount || 0),
      date: recurringDateKey(row) || row.nextRun || row.nextPaymentDate || '',
      vehicleId: vehicle.id || row.vehicleId || '',
      vehicle: vehicle.id ? vehicleNameFromParts(vehicle) : (row.vehicle || row.plan || ''),
      vin: vehicle.vin || row.vin || '',
      plate: tag,
      tracker: vehicle.tracker || row.tracker || '',
      phone: row.phone || '',
      email: row.email || '',
      recurringPaymentId: row.id || '',
      cloverCustomerId: row.cloverCustomerId || '',
      cloverSubscriptionId: row.cloverSubscriptionId || '',
      matchReason: [...new Set(reasons)].join(', '),
      score: score || 1
    });
  }
  recurringRows.forEach(row => {
    if (!row || !row.customer) return;
    const rowAmount = Number(row.amount || row.weeklyAmount || 0);
    const rowDate = recurringDateKey(row) || recordDateKey(row.nextRun || row.nextPaymentDate);
    const customerRef = String(payment.cloverCustomerId || payment.customerId || payment.externalCustomerReference || '').trim();
    let score = 0;
    const reasons = [];
    if (customerRef && (String(row.cloverCustomerId || '') === customerRef || normKey(row.customer) === normKey(customerRef))) {
      score += 5;
      reasons.push('Clover customer reference');
    }
    if (ids.length && ids.includes(String(row.id || ''))) {
      score += 5;
      reasons.push('recurring id');
    }
    if (ids.length && row.cloverSubscriptionId && ids.includes(String(row.cloverSubscriptionId))) {
      score += 5;
      reasons.push('subscription id');
    }
    if (amount && rowAmount && Math.abs(rowAmount - amount) < 0.01) {
      score += 2;
      reasons.push('same amount');
    }
    if (date && rowDate && date === rowDate) {
      score += 1;
      reasons.push('same due date');
    }
    if (payment.phone && row.phone && phoneKey(payment.phone) === phoneKey(row.phone)) {
      score += 3;
      reasons.push('same phone');
    }
    if (payment.email && row.email && emailKey(payment.email) === emailKey(row.email)) {
      score += 3;
      reasons.push('same email');
    }
    (row.paymentAttempts || []).forEach(attempt => {
      const attemptIds = closeoutPaymentIds(attempt);
      const sameId = ids.length && attemptIds.some(id => ids.includes(id));
      const sameDayAmount = date && recordDateKey(attempt.date || attempt.createdAt) === date && amount && Number(attempt.amount || 0) === amount;
      if (sameId) {
        score += 5;
        reasons.push('saved attempt id');
      } else if (sameDayAmount) {
        score += 3;
        reasons.push('same attempt date/amount');
      }
    });
    if (score >= 3) add(row, reasons, score);
  });
  return matches.sort((a, b) => b.score - a.score || String(a.customer).localeCompare(String(b.customer))).slice(0, 5);
}
function reportPaymentCandidateNote(data = {}, payment = {}, recurringRows = allRecurringRows(data)) {
  return closeoutPaymentPossibleMatches(data, payment, recurringRows).slice(0, 3).map(candidate => {
    return [
      'Possible match ' + (candidate.customer || 'customer'),
      candidate.vehicle || '',
      candidate.vin ? 'VIN ' + candidate.vin : '',
      candidate.plate ? 'Tag ' + candidate.plate : '',
      candidate.tracker ? 'Tracker ' + candidate.tracker : '',
      candidate.matchReason || ''
    ].filter(Boolean).join(' / ');
  }).join(' || ');
}
function reportRowsForData(data = {}, user = { role: 'Owner' }) {
  const scoped = isOwnerUser(user) ? data : dataScopedToOrganization(data, userOrganizationId(user));
  enrichLinkedProfiles(scoped);
  const rows = [['Section', 'Date', 'Customer', 'Vehicle', 'VIN', 'Tag / plate', 'Tracker', 'Type', 'Amount', 'Status', 'Source', 'Notes']];
  const today = localDateKey();
  const recurring = allRecurringRows(scoped);
  const dueRows = recurring.filter(row => recurringDateKey(row) === today || String(row.lastAutoChargeDate || row.lastAutoChargeAttemptDate || '') === today || /fail|not found|retry|contact/i.test(String(row.status || '')));
  const payments = uniqueCloseoutPayments(scoped.payments || []);
  const todayPayments = payments.filter(payment => recordDateKey(payment.date || payment.createdAt) === today);
  const collectedToday = todayPayments.filter(closeoutPaymentPaid).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const expectedToday = dueRows.reduce((sum, row) => sum + Number(row.amount || row.weeklyAmount || 0), 0);
  addReportRow(rows, 'Daily closeout', today, 'All customers', '', '', '', '', 'Expected today', expectedToday, 'Open', 'WheelsonAuto', 'Due, paid, failed, setup, and payment-not-found customers tracked today');
  addReportRow(rows, 'Daily closeout', today, 'All customers', '', '', '', '', 'Collected today', collectedToday, 'Paid', 'WheelsonAuto/Clover', 'Collected transactions are deduped and exclude failed/refund/dispute records');
  addReportRow(rows, 'Daily closeout', today, 'All customers', '', '', '', '', 'Verification inbox', closeoutVerificationItems(scoped).length, 'Review', 'WheelsonAuto verification', 'Customer proof, paid-outside, service, toll, claim, and document reviews waiting');
  payments.forEach(payment => {
    const customer = closeoutPaymentCustomerName(scoped, payment, recurring);
    const vehicle = reportVehicleFor(scoped, customer, payment.vehicleId);
    const tag = vehicle.plate || vehicle.stock || payment.licensePlate || payment.plate || '';
    const matchNote = customer === 'Unmatched payment' ? reportPaymentCandidateNote(scoped, payment, recurring) : '';
    addReportRow(rows, 'Transactions', payment.date || payment.createdAt || '', customer, vehicle.id ? vehicleNameFromParts(vehicle) : (payment.vehicle || ''), vehicle.vin || payment.vin || '', tag, vehicle.tracker || payment.tracker || '', payment.method || payment.type || 'Payment', payment.amount || 0, payment.status || 'Recorded', payment.source || payment.provider || 'Payment', reportCsvNote([payment.notes, payment.error, matchNote, payment.externalReferenceId, payment.cloverPaymentId, payment.paymentRequestId]));
  });
  recurring.forEach(row => {
    const vehicle = reportVehicleFor(scoped, row.customer, row.vehicleId);
    const tag = vehicle.plate || vehicle.stock || row.licensePlate || row.plate || '';
    addReportRow(rows, 'Autopay roster', recurringDateKey(row) || row.nextRun || row.nextPaymentDate || '', row.customer || 'Unknown customer', vehicle.id ? vehicleNameFromParts(vehicle) : (row.vehicle || ''), vehicle.vin || row.vin || '', tag, vehicle.tracker || row.tracker || '', row.frequency || 'Weekly', row.amount || row.weeklyAmount || 0, closeoutRecurringState(row), row.sourceType || row.provider || 'WheelsonAuto/Clover', reportCsvNote([row.phone, row.email, row.cloverCustomerId ? 'Clover customer ' + row.cloverCustomerId : '', row.cloverSubscriptionId ? 'Subscription ' + row.cloverSubscriptionId : '', row.notes]));
  });
  const customerNames = [...new Set([...(scoped.customers || []).map(row => row.name || row.customer), ...(scoped.contracts || []).map(row => row.customer || row.name), ...recurring.map(row => row.customer)].map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const activeCustomerNames = [];
  customerNames.forEach(name => {
    const recurringRow = recurring.find(row => normKey(row.customer) === normKey(name)) || {};
    const customer = (scoped.customers || []).find(row => normKey(row.name || row.customer) === normKey(name)) || {};
    const contract = (scoped.contracts || []).find(row => normKey(row.customer || row.name) === normKey(name)) || {};
    const vehicle = reportVehicleFor(scoped, name, recurringRow.vehicleId || customer.vehicleId || contract.vehicleId);
    const tag = vehicle.plate || vehicle.stock || customer.licensePlate || contract.licensePlate || recurringRow.licensePlate || '';
    const active = !/removed|returned|history|archived/i.test(String(contract.status || customer.status || recurringRow.status || 'Active'));
    if (active) activeCustomerNames.push(name);
    addReportRow(rows, 'Customer files', '', name, vehicle.id ? vehicleNameFromParts(vehicle) : (customer.vehicle || contract.vehicle || recurringRow.vehicle || ''), vehicle.vin || customer.vin || contract.vin || recurringRow.vin || '', tag, vehicle.tracker || customer.tracker || contract.tracker || recurringRow.tracker || '', 'Customer truth', customer.weeklyAmount || recurringRow.amount || contract.weekly || 0, active ? 'Active' : 'History', active ? 'Customer active' : 'Customer history', reportCsvNote([customer.phone || contract.phone || recurringRow.phone, customer.email || contract.email || recurringRow.email, 'Risk: ' + reportCustomerRisk(scoped, name, recurringRow, vehicle), contract.id ? 'File ' + contract.id : 'No file yet']));
  });
  (scoped.vehicles || []).forEach(vehicle => {
    const customer = vehicle.currentCustomer || vehicle.customer || 'In lot';
    const maintenance = (scoped.maintenance || []).filter(row => row.vehicleId === vehicle.id || normKey(row.vehicle) === normKey(vehicleNameFromParts(vehicle)));
    const claims = (scoped.claims || []).filter(row => row.vehicleId === vehicle.id || normKey(row.vehicle) === normKey(vehicleNameFromParts(vehicle)) || normKey(row.plate || row.reference) === normKey(vehicle.plate || vehicle.stock));
    const income = payments.filter(payment => normKey(closeoutPaymentCustomerName(scoped, payment, recurring)) === normKey(customer) && closeoutPaymentPaid(payment)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const serviceCost = maintenance.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const openRecovery = claims.filter(item => !/paid|closed/i.test(String(item.status || 'Open'))).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    addReportRow(rows, 'Fleet profitability', '', customer, vehicleNameFromParts(vehicle), vehicle.vin || '', vehicle.plate || vehicle.stock || '', vehicle.tracker || '', 'Car profitability', income - serviceCost + openRecovery, vehicle.status || 'Ready', 'Fleet', reportCsvNote(['Income ' + moneyText(income), 'Service cost ' + moneyText(serviceCost), 'Open recovery ' + moneyText(openRecovery), maintenance.filter(item => !/complete|fixed|closed/i.test(String(item.status || ''))).length + ' open service']));
  });
  (scoped.maintenance || []).forEach(item => {
    const vehicle = reportVehicleFor(scoped, item.customer, item.vehicleId);
    addReportRow(rows, 'Service / inspections', item.completedAt || item.fixedAt || item.due || item.nextDue || '', item.customer || vehicle.currentCustomer || '', item.vehicle || (vehicle.id ? vehicleNameFromParts(vehicle) : ''), vehicle.vin || item.vin || '', vehicle.plate || vehicle.stock || item.plate || '', vehicle.tracker || item.tracker || '', item.type || item.issue || 'Maintenance', item.cost || 0, item.status || 'Scheduled', item.source || 'Maintenance', reportCsvNote([item.issue, item.notes, item.odometer || item.mileageAtService ? 'Mileage ' + (item.odometer || item.mileageAtService) : '', item.inspectionCondition ? 'Condition ' + item.inspectionCondition : '', item.mechanicSignoff ? 'Signed ' + item.mechanicSignoff : '']));
  });
  (scoped.claims || []).forEach(claim => {
    const vehicle = reportVehicleFor(scoped, claim.customer, claim.vehicleId);
    addReportRow(rows, 'Claims / tolls / disputes', claim.createdAt || claim.incidentDate || claim.nextFollowUp || '', claim.customer || 'Unmatched', vehicle.id ? vehicleNameFromParts(vehicle) : (claim.vehicle || ''), vehicle.vin || claim.vin || '', vehicle.plate || vehicle.stock || claim.plate || claim.reference || '', vehicle.tracker || claim.tracker || '', claim.type || 'Issue', claim.amount || 0, claim.status || 'Open', claim.source || claim.provider || claim.agency || 'Manual', reportCsvNote([claim.notes, claim.customerMatchStatus, reportClaimCandidateNote(claim), claim.externalId || claim.caseId || claim.disputeId, claim.deadline ? 'Deadline ' + claim.deadline : '', claim.evidence || claim.proofUrl || '']));
  });
  (scoped.applications || []).forEach(app => addReportRow(rows, 'Applications', app.submittedAt || app.createdAt || '', app.name || app.customer || '', app.vehicle || '', app.vin || '', app.plate || '', app.tracker || '', 'Application', app.down || 0, app.stage || app.status || 'New', 'Website/apply', reportCsvNote([app.phone, app.email, app.license, app.employer, app.notes])));
  (scoped.documents || []).filter(doc => !doc.system).forEach(doc => {
    const vehicle = reportVehicleFor(scoped, doc.customer, doc.vehicleId);
    const tag = vehicle.plate || vehicle.stock || doc.plate || doc.licensePlate || '';
    addReportRow(rows, 'Documents / verification', doc.verifiedAt || doc.expires || doc.due || doc.createdAt || '', doc.customer || '', vehicle.id ? vehicleNameFromParts(vehicle) : (doc.vehicle || ''), vehicle.vin || doc.vin || '', tag, vehicle.tracker || doc.tracker || '', doc.type || doc.kind || 'Document', 0, doc.status || 'Active', doc.provider || doc.agency || doc.visibility || 'Document vault', reportCsvNote([doc.policyNumber || doc.reference, doc.verifiedBy ? 'Verified by ' + doc.verifiedBy : '', doc.customerVisible ? 'Customer visible' : 'Staff only', doc.requiresVerification ? 'Needs verification' : '', doc.notes, doc.url || doc.proofUrl || '']));
  });
  closeoutVerificationItems(scoped).forEach(item => addReportRow(rows, 'Verification inbox', today, item.customer || 'Unassigned', '', '', '', '', item.type || 'Review', 0, 'Review', 'WheelsonAuto verification', item.detail || ''));
  const missingVin = (scoped.vehicles || []).filter(vehicle => !String(vehicle.vin || '').trim() && !/removed/i.test(String(vehicle.status || '')));
  const missingVehicle = recurring.filter(row => row.customer && !/removed|history/i.test(String(row.status || '')) && !(row.vehicleId || row.vin || row.licensePlate || row.plate || row.vehicle));
  const missingInsurance = activeCustomerNames.filter(name => !reportDocumentClearedForCustomer(scoped, name, 'insurance'));
  const missingBackground = activeCustomerNames.filter(name => !reportDocumentClearedForCustomer(scoped, name, 'background'));
  addReportRow(rows, 'Star QA', today, 'All customers', '', '', '', '', 'Missing VIN', missingVin.length, missingVin.length ? 'Review' : 'Clean', 'Star QA', 'Fleet records without VIN');
  addReportRow(rows, 'Star QA', today, 'All customers', '', '', '', '', 'Autopay vehicle link', missingVehicle.length, missingVehicle.length ? 'Review' : 'Clean', 'Star QA', 'Autopay rows missing car/VIN/tag/tracker');
  addReportRow(rows, 'Star QA', today, 'All customers', '', '', '', '', 'Insurance proof', missingInsurance.length, missingInsurance.length ? 'Review' : 'Clean', 'Star QA', 'Active customers missing insurance proof');
  addReportRow(rows, 'Star QA', today, 'All customers', '', '', '', '', 'Background checks', missingBackground.length, missingBackground.length ? 'Review' : 'Clean', 'Star QA', 'Active customers missing background verification');
  if (isOwnerUser(user)) (scoped.auditLogs || []).forEach(audit => addReportRow(rows, 'Audit trail', audit.at || '', audit.user || '', audit.companyName || '', '', '', '', audit.action || 'Audit', 0, audit.role || '', 'WheelsonAuto', audit.details || ''));
  return rows;
}
function deepReportCsv(data = {}, user = { role: 'Owner' }) {
  return reportRowsForData(data, user).map(row => row.map(reportCsvCell).join(',')).join('\n') + '\n';
}
function systemHealthSnapshot(data = {}, user = { role: 'Owner' }) {
  const scoped = isOwnerUser(user) ? data : dataScopedToOrganization(data, userOrganizationId(user));
  enrichLinkedProfiles(scoped);
  const today = localDateKey();
  const role = String(user && user.role || 'Owner');
  const recurring = allRecurringRows(scoped);
  const payments = uniqueCloseoutPayments(scoped.payments || []);
  const dueToday = recurring.filter(row => recurringDateKey(row) === today || String(row.lastAutoChargeDate || row.lastAutoChargeAttemptDate || '') === today || /fail|not found|retry|contact/i.test(String(row.status || '')));
  const failedOnce = dueToday.filter(row => closeoutRecurringState(row) === 'Failed once');
  const failedTwice = dueToday.filter(row => closeoutRecurringState(row) === 'Failed twice');
  const notFound = dueToday.filter(row => closeoutRecurringState(row) === 'Payment not found');
  const setupNeeded = recurring.filter(row => closeoutRecurringState(row) === 'Setup needed');
  const todayPayments = payments.filter(payment => recordDateKey(payment.date || payment.createdAt) === today);
  const collectedPaymentsToday = todayPayments.filter(closeoutPaymentPaid);
  const paidOutsideToday = collectedPaymentsToday.filter(closeoutPaymentOutsideApp);
  const cloverPaymentsToday = collectedPaymentsToday.filter(payment => /clover/i.test(String([payment.source, payment.method, payment.type, payment.notes].filter(Boolean).join(' '))) && !closeoutPaymentOutsideApp(payment));
  const collectedToday = collectedPaymentsToday.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const paidOutsideAmountToday = paidOutsideToday.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const cloverCollectedToday = cloverPaymentsToday.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const expectedToday = dueToday.reduce((sum, row) => sum + Number(row.amount || row.weeklyAmount || 0), 0);
  const unmatchedPayments = payments.filter(payment => closeoutPaymentCustomerName(scoped, payment, recurring) === 'Unmatched payment');
  const missingVin = (scoped.vehicles || []).filter(vehicle => !String(vehicle.vin || '').trim() && !/removed/i.test(String(vehicle.status || '')));
  const missingVehicle = recurring.filter(row => row.customer && !/removed|history/i.test(String(row.status || '')) && !(row.vehicleId || row.vin || row.licensePlate || row.plate || row.vehicle));
  const missingContact = recurring.filter(row => row.customer && !row.phone && !row.email);
  const customerNames = [...new Set([...(scoped.customers || []).map(row => row.name || row.customer), ...(scoped.contracts || []).map(row => row.customer || row.name), ...recurring.map(row => row.customer)].map(value => String(value || '').trim()).filter(Boolean))];
  const activeCustomerNames = customerNames.filter(name => {
    const recurringRow = recurring.find(row => normKey(row.customer) === normKey(name)) || {};
    const customer = (scoped.customers || []).find(row => normKey(row.name || row.customer) === normKey(name)) || {};
    const contract = (scoped.contracts || []).find(row => normKey(row.customer || row.name) === normKey(name)) || {};
    return !/removed|returned|history|archived/i.test(String(contract.status || customer.status || recurringRow.status || 'Active'));
  });
  const missingInsurance = activeCustomerNames.filter(name => !reportDocumentClearedForCustomer(scoped, name, 'insurance'));
  const missingBackground = activeCustomerNames.filter(name => !reportDocumentClearedForCustomer(scoped, name, 'background'));
  const verificationInbox = closeoutVerificationItems(scoped);
  const openService = (scoped.maintenance || []).filter(item => {
    const status = String(item.status || '').toLowerCase();
    return !/(complete|fixed|closed)/.test(status);
  });
  const serviceDue = openService.filter(item => {
    const due = recordDateKey(item.due || item.nextDue || item.followUp || '');
    return due && due <= today;
  });
  const openClaims = (scoped.claims || []).filter(claim => !/paid|closed/i.test(String(claim.status || 'Open')));
  const disputeMatchReview = openClaims.filter(claim => String(claim.customerMatchStatus || '') === 'Needs payment/customer match' || (/dispute|chargeback|clover/i.test(String([claim.type, claim.source, claim.provider].filter(Boolean).join(' '))) && weakClaimCustomer(claim.customer)));
  const auditToday = isOwnerUser(user) ? (scoped.auditLogs || []).filter(row => recordDateKey(row.at || row.date || row.createdAt) === today) : [];
  const issues = [];
  function issue(priority, key, label, count, tone, view, tab, detail) {
    issues.push({ priority, key, label, count, tone, view, tab: tab || '', detail });
  }
  issue(1, 'failed_twice', 'Failed twice', failedTwice.length, failedTwice.length ? 'bad' : 'good', 'Payments', 'Today', 'Customers need contact before closeout.');
  issue(2, 'payment_not_found', 'Payment not found', notFound.length, notFound.length ? 'warn' : 'good', 'Payments', 'Today', 'Saved-card/payment records need Clover review.');
  issue(3, 'unmatched_payments', 'Unmatched payments', unmatchedPayments.length, unmatchedPayments.length ? 'bad' : 'good', 'Payments', 'Transactions', 'Transactions need customer names for receipts, disputes, and reports.');
  issue(4, 'setup_needed', 'Setup needed', setupNeeded.length, setupNeeded.length ? 'warn' : 'good', 'Payments', 'Today', 'Customers need card setup or card-on-file repair.');
  issue(5, 'missing_vehicle_link', 'Autopay vehicle link', missingVehicle.length, missingVehicle.length ? 'warn' : 'good', 'Payments', 'Active', 'Active autopay rows need car, VIN, tag, and tracker.');
  issue(6, 'missing_vin', 'Missing VIN', missingVin.length, missingVin.length ? 'warn' : 'good', 'Fleet', 'VIN review', 'Fleet records need VINs before claims, inspections, and disputes are tight.');
  issue(7, 'verification_inbox', 'Verification inbox', verificationInbox.length, verificationInbox.length ? 'warn' : 'good', 'Documents', '', 'Customer proof, paid-outside, service, toll, claim, or document reviews waiting.');
  issue(8, 'insurance_proof', 'Insurance proof', missingInsurance.length, missingInsurance.length ? 'warn' : 'good', 'Insurance', '', 'Active customers missing verified insurance proof.');
  issue(9, 'background_checks', 'Background checks', missingBackground.length, missingBackground.length ? 'warn' : 'good', 'Insurance', '', 'Active customers missing background verification.');
  issue(10, 'missing_contact', 'Missing contact', missingContact.length, missingContact.length ? 'warn' : 'good', 'Payments', 'Active', 'Customers need phone or email before Star can follow up.');
  issue(11, 'service_due', 'Service due', serviceDue.length, serviceDue.length ? 'warn' : 'good', 'Operations', 'Service', 'Open service or inspections are due/overdue.');
  issue(12, 'open_claims', 'Open claims/tolls', openClaims.length, openClaims.length ? 'warn' : 'good', 'Claims & Issues', '', 'Open recoveries, tolls, violations, disputes, or damage claims.');
  issue(13, 'dispute_match_review', 'Dispute match review', disputeMatchReview.length, disputeMatchReview.length ? 'bad' : 'good', 'Claims & Issues', '', 'Clover disputes or chargebacks need customer, payment, vehicle, VIN/tag, and proof matched before closeout.');
  if (isOwnerUser(user)) issue(14, 'sensitive_changes', 'Sensitive changes', auditToday.length, auditToday.length ? 'blue' : 'good', 'Reports', '', 'Owner/staff changes logged today for closeout review.');
  const badCount = issues.filter(row => row.tone === 'bad' && Number(row.count || 0) > 0).length;
  const warnCount = issues.filter(row => row.tone === 'warn' && Number(row.count || 0) > 0).length;
  return {
    ok: badCount === 0,
    checkedAt: new Date().toISOString(),
    dateKey: today,
    role,
    organizationId: userOrganizationId(user),
    summary: {
      expectedToday,
      collectedToday,
      stillOpenToday: Math.max(0, expectedToday - collectedToday),
      dueToday: dueToday.length,
      failedOnce: failedOnce.length,
      failedTwice: failedTwice.length,
      paymentNotFound: notFound.length,
      peopleToContact: failedTwice.length + notFound.length,
      setupNeeded: setupNeeded.length,
      paidOutsideApp: paidOutsideToday.length,
      paidOutsideAmount: paidOutsideAmountToday,
      cloverCollected: cloverCollectedToday,
      cloverTransactions: cloverPaymentsToday.length,
      paidTransactions: collectedPaymentsToday.length,
      verificationInbox: verificationInbox.length,
      openService: openService.length,
      openClaims: openClaims.length,
      badCount,
      warnCount
    },
    issues: issues.sort((a, b) => a.priority - b.priority),
    star: {
      canAssist: true,
      guardrails: 'Star can draft fixes and messages, but charges, card changes, removals, claims, refunds, receipts, and unclear money requests still require admin approval.',
      nextActions: issues.filter(row => row.count && row.tone !== 'good').slice(0, 8)
    }
  };
}
function maintenanceDueForNotification(item = {}, dateKeyValue = localDateKey()) {
  const status = String(item.status || '').toLowerCase();
  if (status.includes('complete') || status.includes('fixed') || status.includes('closed')) return false;
  const due = recordDateKey(item.due || item.nextDue || item.followUp || '');
  return !!(due && due <= dateKeyValue);
}
function claimDisputeForNotification(claim = {}) {
  const status = String(claim.status || 'Open').toLowerCase();
  if (status.includes('paid') || status.includes('closed')) return false;
  return /dispute|chargeback|clover/i.test(String([claim.type, claim.source, claim.provider, claim.customerMatchStatus].filter(Boolean).join(' ')));
}
async function queueStateChangeNotifications(previous = {}, data = {}, user = {}) {
  const dateKeyValue = localDateKey();
  const promises = [];
  const previousMaintenance = new Map((previous.maintenance || []).map(item => [item.id, item]));
  const previousClaims = new Map((previous.claims || []).map(item => [item.id, item]));
  (data.maintenance || []).forEach(item => {
    if (!maintenanceDueForNotification(item, dateKeyValue) || item.maintenanceDueNotifiedDate === dateKeyValue) return;
    const old = previousMaintenance.get(item.id) || {};
    if (old.id && maintenanceDueForNotification(old, dateKeyValue) && String(old.status || '') === String(item.status || '') && String(old.due || old.nextDue || '') === String(item.due || item.nextDue || '')) return;
    item.maintenanceDueNotifiedDate = dateKeyValue;
    promises.push(queueOwnerEmailNotification(data, 'maintenance_due', {
      customer: item.customer || item.vehicle || 'Maintenance',
      subject: 'Maintenance due - ' + (item.customer || item.vehicle || 'Vehicle'),
      body: [
        'A maintenance item is due or overdue.',
        'Vehicle: ' + (item.vehicle || item.vehicleId || 'Not linked'),
        'Customer: ' + (item.customer || 'Not linked'),
        'Type: ' + (item.type || item.issue || 'Maintenance'),
        'Due: ' + (item.due || item.nextDue || 'Not set'),
        'Status: ' + (item.status || 'Open'),
        'Saved by: ' + (user.name || user.role || 'WheelsonAuto')
      ].join('\n')
    }));
  });
  (data.claims || []).forEach(claim => {
    if (!claimDisputeForNotification(claim) || claim.claimDisputeNotifiedDate === dateKeyValue) return;
    const old = previousClaims.get(claim.id) || {};
    if (old.id && claimDisputeForNotification(old) && String(old.customerMatchStatus || '') === String(claim.customerMatchStatus || '') && String(old.status || '') === String(claim.status || '')) return;
    claim.claimDisputeNotifiedDate = dateKeyValue;
    promises.push(queueOwnerEmailNotification(data, 'claim_dispute', {
      customer: claim.customer || 'Unmatched dispute',
      subject: 'Claim/dispute needs review - ' + (claim.customer || claim.externalId || claim.disputeId || 'Unmatched'),
      body: [
        'A Clover dispute, chargeback, or claim needs review.',
        'Customer: ' + (claim.customer || 'Unmatched'),
        'Match status: ' + (claim.customerMatchStatus || 'Not set'),
        'Match source: ' + (claim.customerMatchSource || 'None'),
        'Amount: ' + moneyText(claim.amount || 0),
        'Vehicle/ref: ' + ([claim.vehicle, claim.plate || claim.reference].filter(Boolean).join(' | ') || 'Not linked'),
        'Case/payment ID: ' + (claim.externalId || claim.caseId || claim.disputeId || claim.paymentId || 'Not saved'),
        'Saved by: ' + (user.name || user.role || 'WheelsonAuto')
      ].join('\n')
    }));
  });
  await Promise.all(promises);
  return promises.length;
}
function queueCustomerMessage(data, row = {}, template, status, body, tone = 'warn') {
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  const customer = row.customer || row.name || 'Customer';
  const today = new Date().toLocaleDateString('en-US');
  const duplicate = data.messages.some(item =>
    item.customer === customer &&
    item.template === template &&
    String(item.date || '').startsWith(today)
  );
  if (duplicate) return false;
  data.messages.unshift({
    id: 'msg-auto-' + Date.now() + '-' + Math.random().toString(16).slice(2, 7),
    date: new Date().toLocaleString('en-US'),
    createdAt: new Date().toISOString(),
    customer,
    phone: row.phone || '',
    email: row.email || '',
    direction: 'Outbound task',
    channel: 'SMS',
    template,
    subject: template,
    status,
    tone,
    body,
    recurringPaymentId: row.id || '',
    source: 'WheelsonAuto automation'
  });
  return true;
}
function aiMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return '$' + amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function aiCustomerFirstName(value) {
  const first = String(value || '').trim().split(/\s+/).filter(Boolean)[0] || '';
  return first || 'there';
}
function aiContains(text, words) {
  const source = String(text || '').toLowerCase();
  return words.some(word => source.includes(word));
}
function aiMatches(text, pattern) {
  return pattern.test(String(text || '').toLowerCase());
}
function aiLatestPayment(data, context) {
  const name = normKey(context.customerName);
  const recurringId = String(context.recurring && context.recurring.id || '');
  const cloverId = String(context.recurring && context.recurring.cloverCustomerId || '');
  const rows = (data.payments || []).filter(row => {
    if (recurringId && String(row.recurringPaymentId || '') === recurringId) return true;
    if (cloverId && String(row.cloverCustomerId || row.customerId || '') === cloverId) return true;
    if (name && softNameMatch(row.customer, name)) return true;
    return false;
  });
  return rows.sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))[0] || null;
}
function aiSystemHealthForContext(data, user = { role: 'Owner' }) {
  const health = systemHealthSnapshot(data, user);
  return {
    summary: health.summary,
    nextActions: (health.star && health.star.nextActions || []).map(row => ({
      key: row.key,
      label: row.label,
      count: row.count,
      tone: row.tone,
      view: row.view,
      tab: row.tab
    }))
  };
}
function aiFindCustomerContext(data, payload = {}, user = { role: 'Owner' }) {
  enrichLinkedProfiles(data);
  const contact = findMessageContact(data, payload);
  const phone = phoneKey(payload.phone || payload.from || contact.phone || '');
  const email = emailKey(payload.email || contact.email || '');
  const name = normKey(payload.customer || contact.name || payload.name || '');
  const recurringRows = allRecurringRows(data);
  let recurring = null;
  if (payload.recurringPaymentId || payload.id) recurring = findRecurringRow(data, payload.recurringPaymentId || payload.id);
  if (!recurring && phone) recurring = recurringRows.find(row => phoneKey(row.phone) === phone);
  if (!recurring && email) recurring = recurringRows.find(row => emailKey(row.email) === email);
  if (!recurring && name) recurring = recurringRows.find(row => softNameMatch(row.customer, name));
  const customerRows = data.customers || [];
  let customer = null;
  if (phone) customer = customerRows.find(row => phoneKey(row.phone) === phone);
  if (!customer && email) customer = customerRows.find(row => emailKey(row.email) === email);
  if (!customer && name) customer = customerRows.find(row => softNameMatch(row.name || row.customer, name));
  const contractRows = data.contracts || [];
  let contract = null;
  if (phone) contract = contractRows.find(row => phoneKey(row.phone) === phone);
  if (!contract && email) contract = contractRows.find(row => emailKey(row.email) === email);
  if (!contract && name) contract = contractRows.find(row => softNameMatch(row.customer || row.name, name));
  const customerName = (recurring && recurring.customer) || (customer && (customer.name || customer.customer)) || (contract && (contract.customer || contract.name)) || contact.name || payload.customer || payload.from || 'Customer';
  const vehicleId = (recurring && recurring.vehicleId) || (customer && customer.vehicleId) || (contract && contract.vehicleId) || '';
  let vehicle = vehicleId ? (data.vehicles || []).find(row => row.id === vehicleId) : null;
  if (!vehicle && customerName) vehicle = (data.vehicles || []).find(row => softNameMatch(row.currentCustomer || row.customer, customerName));
  const vehicleName = vehicle ? vehicleNameFromParts(vehicle) : ((recurring && recurring.vehicle) || (customer && customer.vehicle) || (contract && contract.vehicle) || '');
  if (!vehicle && vehicleName) vehicle = (data.vehicles || []).find(row => normKey(vehicleNameFromParts(row)) === normKey(vehicleName));
  const latestPayment = aiLatestPayment(data, { customerName, recurring });
  const maintenance = (data.maintenance || []).filter(row => {
    if (vehicle && (row.vehicleId === vehicle.id || normKey(row.vehicle) === normKey(vehicleNameFromParts(vehicle)))) return true;
    return customerName && softNameMatch(row.customer, customerName);
  }).slice(0, 6);
  const claims = (data.claims || []).filter(row => {
    if (customerName && softNameMatch(row.customer, customerName)) return true;
    if (vehicle && (row.vehicleId === vehicle.id || normKey(row.vehicle) === normKey(vehicleNameFromParts(vehicle)))) return true;
    return false;
  }).slice(0, 8);
  const openClaims = claims.filter(row => !/paid|closed|done|removed/i.test(String(row.status || 'Open')) && Number(row.amount || 0) > 0);
  const latestMessages = (data.messages || []).filter(row => {
    if (/AI draft|AI action/i.test(String(row.direction || ''))) return false;
    if (phone && phoneKey(row.phone || row.from || row.to) === phone) return true;
    return customerName && softNameMatch(row.customer, customerName);
  }).slice(0, 8);
  return {
    contact,
    customerName,
    phone: payload.phone || contact.phone || (recurring && recurring.phone) || (customer && customer.phone) || (contract && contract.phone) || '',
    email: payload.email || contact.email || (recurring && recurring.email) || (customer && customer.email) || (contract && contract.email) || '',
    recurring,
    customer,
    contract,
    vehicle,
    vehicleName,
    latestPayment,
    maintenance,
    claims,
    openClaims,
    latestMessages,
    platformModules: {
      payments: (data.payments || []).length,
      recurringPayments: recurringRows.length,
      vehicles: (data.vehicles || []).length,
      maintenance: (data.maintenance || []).length,
      claimsAndTolls: (data.claims || []).length,
      tasks: (data.tasks || []).length,
      apiProviders: (data.apiProviders || []).length,
      ezPassReady: !!(((data.integrations || {}).ezpass || {}).connected),
      emailReady: messageSettings(data).emailEnabled && !!(((data.integrations || {}).email || {}).connected),
      emailProvider: (((data.integrations || {}).email || {}).provider) || WOA_EMAIL_PROVIDER
    },
    systemHealth: aiSystemHealthForContext(data, user)
  };
}
function aiContextSummary(context) {
  const r = context.recurring || {};
  const v = context.vehicle || {};
  const amount = aiMoney(r.amount || r.weeklyAmount || context.customer && context.customer.weeklyAmount || v.rate || 0);
  return {
    customer: context.customerName,
    phone: context.phone ? maskPhone(context.phone) : '',
    email: context.email || '',
    vehicle: context.vehicleName || '',
    vin: v.vin || r.vin || context.customer && context.customer.vin || context.contract && context.contract.vin || '',
    tag: v.plate || v.stock || r.plate || r.licensePlate || '',
    tracker: v.tracker || r.tracker || '',
    amount,
    frequency: r.frequency || '',
    nextRun: r.nextRun || '',
    chargeTime: r.chargeTime || '',
    paymentStatus: r.status || '',
    paymentSetup: r.paymentSetup || (r.cloverPaymentSource ? 'Card linked' : ''),
    lastPayment: context.latestPayment ? [context.latestPayment.status, aiMoney(context.latestPayment.amount), context.latestPayment.date].filter(Boolean).join(' ') : '',
    openClaims: context.openClaims.map(row => ({ id: row.id || '', type: row.type || 'Balance', amount: aiMoney(row.amount || 0), status: row.status || 'Open' })),
    maintenance: context.maintenance.map(row => ({ id: row.id || '', vehicle: row.vehicle || context.vehicleName || '', type: row.type || row.issue || 'Service', due: row.due || row.nextDue || '', status: row.status || '' })),
    modules: context.platformModules,
    systemHealth: context.systemHealth
  };
}
function aiPlanRules(data, payload = {}, context = null) {
  const ctx = context || aiFindCustomerContext(data, payload);
  const body = String(payload.body || payload.message || payload.text || '').trim();
  const lower = body.toLowerCase();
  const recurring = ctx.recurring || {};
  const openClaim = ctx.openClaims[0] || null;
  const customer = ctx.customerName || payload.customer || 'Customer';
  const first = aiCustomerFirstName(customer);
  const amountText = aiMoney(payload.amount || recurring.amount || recurring.weeklyAmount || (openClaim && openClaim.amount) || 0);
  const vehicleText = ctx.vehicleName ? ' for the ' + ctx.vehicleName : '';
  const dueText = recurring.nextRun ? ' Your next scheduled payment is ' + recurring.nextRun + (recurring.chargeTime ? ' at ' + recurring.chargeTime + '.' : '.') : '';
  const humanWords = ['accident', 'police', 'lawyer', 'attorney', 'lawsuit', 'sue', 'refund', 'chargeback', 'insurance', 'stolen', 'repo', 'repossession', 'complaint', 'angry', 'mad', 'cancel', 'remove me', 'stop autopay', 'stop payment'];
  const dateWords = ['change date', 'move date', 'move my payment', 'change my payment', 'change autopay', 'switch day', 'different day', 'next week', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let actionType = 'reply';
  let intent = 'general_reply';
  let approvalRequired = false;
  let needsHuman = false;
  let tone = 'blue';
  let confidence = 0.72;
  let reply = 'Hi ' + first + ', this is WheelsonAuto. I can help with that. Let me pull up your account and we will follow up shortly.';
  const reasons = [];
  if (!body) {
    needsHuman = true;
    actionType = 'human_review';
    intent = 'empty_message';
    reply = 'Hi ' + first + ', this is WheelsonAuto. I got your message, but I need a little more detail so we can help you.';
    reasons.push('No customer message body was provided.');
  } else if (aiContains(lower, humanWords)) {
    needsHuman = true;
    actionType = 'human_review';
    intent = 'sensitive_or_dispute';
    tone = 'bad';
    confidence = 0.9;
    reply = 'Hi ' + first + ', this is WheelsonAuto. I understand. I am sending this to our team so a person can review your account and respond the right way.';
    reasons.push('Sensitive, dispute, cancellation, legal, or account-removal wording needs a human.');
  } else if (aiMatches(lower, /charge (me|my card)|run (it|my card)|take (it|the payment)|pay it now|use my card|use (the )?card on file|charge (the )?card on file/)) {
    actionType = 'charge_saved_card';
    intent = 'charge_request';
    approvalRequired = true;
    tone = 'warn';
    confidence = 0.88;
    reply = 'Hi ' + first + ', I see your request to run the payment' + vehicleText + '. I am sending it to the office for approval, and we will confirm once it is processed.';
    reasons.push('Customer requested a saved-card charge. Admin approval is required before money moves.');
  } else if (aiContains(lower, ['payment link', 'pay link', 'send link', 'link to pay', 'can i pay', 'how do i pay']) || aiMatches(lower, /\blink\b.*\bpay\b|\bpay\b.*\blink\b/)) {
    actionType = 'send_payment_link';
    intent = 'payment_link';
    tone = 'good';
    confidence = 0.9;
    reply = 'Hi ' + first + ', no problem. I can send you a secure WheelsonAuto payment link' + (amountText ? ' for ' + amountText : '') + '.';
    reasons.push('A payment link is safe because the customer still chooses to pay through Clover checkout.');
  } else if (aiContains(lower, ['change card', 'new card', 'update card', 'card setup', 'save card', 'replace card', 'card on file'])) {
    actionType = 'send_card_setup';
    intent = 'card_update';
    tone = 'good';
    confidence = 0.86;
    reply = 'Hi ' + first + ', I can send a secure card setup link so you can update your card on file. WheelsonAuto will not see your full card number.';
    reasons.push('Card setup link is safe; the customer enters card details in Clover secure fields.');
  } else if (aiContains(lower, ['toll', 'ez pass', 'ezpass', 'violation', 'ticket', 'reimbursement', 'claim', 'receipt'])) {
    actionType = openClaim ? 'send_claim_link' : 'human_review';
    intent = 'toll_claim_or_receipt';
    approvalRequired = !!openClaim;
    needsHuman = !openClaim;
    tone = openClaim ? 'warn' : 'blue';
    confidence = 0.82;
    reply = openClaim
      ? 'Hi ' + first + ', I found the open ' + (openClaim.type || 'balance') + (openClaim.amount ? ' for ' + aiMoney(openClaim.amount) : '') + '. I am sending it to the office for approval before any charge or receipt is sent.'
      : 'Hi ' + first + ', I got your toll/receipt question. I am sending this to the office so we can check the account and respond with the right details.';
    reasons.push(openClaim ? 'Toll/claim/reimbursement balance found; approval required before collection or receipt.' : 'No open toll/claim balance was matched yet.');
  } else if (aiContains(lower, dateWords) || aiMatches(lower, /\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/)) {
    actionType = 'change_autopay_date';
    intent = 'schedule_change';
    approvalRequired = true;
    tone = 'warn';
    confidence = 0.84;
    reply = 'Hi ' + first + ', I see you want to change your autopay date. I am sending that request to the office for approval so the schedule is updated correctly.' + dueText;
    reasons.push('Autopay date/time/frequency changes require admin approval.');
  } else if (aiContains(lower, ['maintenance', 'oil change', 'inspection', 'service', 'appointment', 'schedule', 'what time', 'time do i come', 'come in'])) {
    actionType = 'maintenance_schedule';
    intent = 'maintenance_or_schedule';
    tone = 'good';
    confidence = 0.8;
    reply = 'Hi ' + first + ', we can help schedule that' + vehicleText + '. What day and time works best for you?';
    reasons.push('Normal scheduling/service conversation can be answered by AI.');
  } else if (aiContains(lower, ['paid', 'i paid', 'already paid', 'cash', 'zelle', 'outside app'])) {
    actionType = 'paid_outside_review';
    intent = 'paid_outside_app';
    approvalRequired = true;
    tone = 'warn';
    confidence = 0.8;
    reply = 'Hi ' + first + ', thank you for letting us know. I am sending this to the office to verify and mark your account correctly.';
    reasons.push('Paid-outside-app claims need admin verification before account status changes.');
  } else {
    reply = 'Hi ' + first + ', this is WheelsonAuto. Thanks for reaching out.' + dueText + ' We will take care of this and follow up if we need anything else.';
    reasons.push('General customer message can receive a normal human-sounding reply.');
  }
  const canAutoSend = !approvalRequired && !needsHuman && ['reply', 'send_payment_link', 'send_card_setup', 'maintenance_schedule'].includes(actionType);
  return {
    ok: true,
    mode: 'rules',
    intent,
    actionType,
    approvalRequired,
    needsHuman,
    canAutoSend,
    confidence,
    tone,
    reply,
    summary: actionType.replace(/_/g, ' ') + ' for ' + customer,
    reasons,
    related: {
      recurringPaymentId: recurring.id || '',
      cloverCustomerId: recurring.cloverCustomerId || '',
      claimId: openClaim && openClaim.id || '',
      amount: Number(payload.amount || recurring.amount || recurring.weeklyAmount || openClaim && openClaim.amount || 0),
      nextRun: recurring.nextRun || '',
      chargeTime: recurring.chargeTime || '',
      vehicleId: ctx.vehicle && ctx.vehicle.id || '',
      vehicle: ctx.vehicleName || ''
    },
    customer,
    phone: ctx.phone || payload.phone || '',
    context: aiContextSummary(ctx)
  };
}
function sanitizeAiPlan(plan, fallback) {
  const safe = { ...(fallback || {}), ...(plan || {}) };
  safe.ok = true;
  safe.reply = String(safe.reply || (fallback && fallback.reply) || '').trim().slice(0, 900);
  safe.intent = String(safe.intent || 'general_reply').slice(0, 80);
  safe.actionType = String(safe.actionType || 'reply').slice(0, 80);
  safe.approvalRequired = !!safe.approvalRequired || ['charge_saved_card', 'change_autopay_date', 'send_claim_link', 'paid_outside_review'].includes(safe.actionType);
  safe.needsHuman = !!safe.needsHuman || safe.actionType === 'human_review';
  safe.canAutoSend = !!safe.canAutoSend && !safe.approvalRequired && !safe.needsHuman;
  safe.confidence = Math.max(0, Math.min(1, Number(safe.confidence || 0.7)));
  safe.tone = ['good', 'warn', 'bad', 'blue'].includes(safe.tone) ? safe.tone : (safe.needsHuman ? 'bad' : safe.approvalRequired ? 'warn' : 'blue');
  safe.reasons = Array.isArray(safe.reasons) ? safe.reasons.slice(0, 6).map(String) : [];
  safe.related = { ...((fallback && fallback.related) || {}), ...(safe.related || {}) };
  safe.context = (fallback && fallback.context) || safe.context || {};
  return safe;
}
async function openAiReplyPlan(data, payload, context, fallback) {
  if (!OPENAI_API_KEY || !WOA_AI_MODEL) return fallback;
  const input = [
    {
      role: 'developer',
      content: 'You are Star AI, the built-in WheelsonAuto AI manager. Write concise, natural SMS replies that sound like a helpful human office assistant. Use the platform context only. Never promise a charge, refund, autopay change, cancellation, removal, toll charge, or saved-card action has happened unless an admin approved it. Return only JSON with fields: reply, intent, actionType, approvalRequired, needsHuman, canAutoSend, confidence, tone, reasons.'
    },
    {
      role: 'user',
      content: JSON.stringify({
        customerMessage: payload.body || payload.message || payload.text || '',
        platformContext: aiContextSummary(context),
        allowedWithoutApproval: ['general reply', 'payment link draft/send', 'card setup link draft/send', 'maintenance scheduling'],
        futureChannels: ['SMS now', 'email when provider is connected', 'receipts after approved payments', 'EZPass/tolls after provider is connected'],
        requiresAdminApproval: ['saved-card charge', 'toll or claim charge', 'autopay date/time/frequency change', 'card removal', 'account removal', 'refund/dispute', 'paid outside app verification', 'receipt after charge confirmation']
      })
    }
  ];
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: WOA_AI_MODEL, input, reasoning: { effort: 'low' } })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error && body.error.message || 'OpenAI response failed.');
    const text = body.output_text || (body.output || []).flatMap(item => item.content || []).map(part => part.text || '').join('\n');
    const parsed = JSON.parse(String(text || '{}').replace(/^```json|```$/g, '').trim());
    return sanitizeAiPlan({ ...parsed, mode: 'openai' }, fallback);
  } catch (err) {
    return sanitizeAiPlan({ ...fallback, mode: 'rules', aiError: String(err && err.message || err) }, fallback);
  }
}
function appendLinkToReply(reply, label, url) {
  if (!url || String(reply || '').includes(url)) return reply;
  return String(reply || '').trim() + '\n\n' + label + ': ' + url;
}
function prepareAiSafeLink(data, plan, context) {
  if (!plan || plan.needsHuman || plan.approvalRequired) return plan;
  const recurring = context.recurring || {};
  if (plan.actionType === 'send_payment_link') {
    const amount = Number(plan.related && plan.related.amount || recurring.amount || recurring.weeklyAmount || 0);
    if (!amount || amount <= 0) {
      plan.needsHuman = true;
      plan.canAutoSend = false;
      plan.status = 'Human needed';
      plan.reasons = [...(plan.reasons || []), 'No payment amount was found for the secure link.'];
      plan.reply = 'Hi ' + aiCustomerFirstName(plan.customer || context.customerName) + ', I can help with a secure payment link. I am sending this to the office first so we send the correct amount.';
      return plan;
    }
    data.paymentRequests = Array.isArray(data.paymentRequests) ? data.paymentRequests : [];
    const request = createPaymentRequest(data, {
      recurringPaymentId: recurring.id || plan.related && plan.related.recurringPaymentId || '',
      customer: context.customerName || plan.customer || '',
      phone: context.phone || plan.phone || '',
      email: context.email || '',
      vehicle: context.vehicleName || '',
      amount,
      frequency: recurring.frequency || 'Payment'
    });
    data.paymentRequests.unshift(request);
    if (recurring.id) updateRecurringChargeState(data, recurring.id, { lastPaymentLinkAt: new Date().toISOString(), lastPaymentLinkUrl: request.url });
    plan.related = { ...(plan.related || {}), paymentLinkId: request.id, paymentLinkUrl: request.url };
    plan.reply = appendLinkToReply(plan.reply, 'Secure payment link', request.url);
    plan.summary = 'Secure payment link ready for ' + (plan.customer || context.customerName || 'customer');
  }
  if (plan.actionType === 'send_card_setup') {
    const amount = Number(plan.related && plan.related.amount || recurring.amount || recurring.weeklyAmount || 0);
    if (!amount || amount <= 0 || !(context.customerName || plan.customer)) {
      plan.needsHuman = true;
      plan.canAutoSend = false;
      plan.status = 'Human needed';
      plan.reasons = [...(plan.reasons || []), 'No customer or recurring amount was found for the secure card setup link.'];
      plan.reply = 'Hi ' + aiCustomerFirstName(plan.customer || context.customerName) + ', I can help update your card on file. I am sending this to the office first so we send the correct secure setup link.';
      return plan;
    }
    const setup = createCardSetupRequest(data, {
      id: recurring.id || '',
      recurringPaymentId: recurring.id || '',
      reactivateExisting: !!recurring.id,
      cardOnlyUpdate: !!recurring.id,
      customer: context.customerName || plan.customer || '',
      phone: context.phone || plan.phone || '',
      email: context.email || '',
      vehicle: context.vehicleName || '',
      vehicleId: context.vehicle && context.vehicle.id || '',
      vin: context.vehicle && context.vehicle.vin || '',
      licensePlate: context.vehicle && (context.vehicle.plate || context.vehicle.licensePlate) || '',
      tempTag: context.vehicle && context.vehicle.tempTag || '',
      tracker: context.vehicle && context.vehicle.tracker || '',
      amount,
      frequency: recurring.frequency || 'Weekly',
      nextRun: recurring.nextRun || localDateKey(),
      chargeTime: recurring.chargeTime || recurring.paymentTime || '18:00',
      reason: 'Star card setup request',
      notes: 'Created by Star from a customer card-on-file message.'
    });
    plan.related = { ...(plan.related || {}), cardSetupRequestId: setup.request.id, cardSetupUrl: setup.request.url, recurringPaymentId: setup.autopay.id || plan.related && plan.related.recurringPaymentId || '' };
    plan.reply = appendLinkToReply(plan.reply, 'Secure card setup link', setup.request.url);
    plan.summary = 'Secure card setup link ready for ' + (plan.customer || context.customerName || 'customer');
  }
  return plan;
}
async function createAiMessageDraft(data, payload = {}, options = {}) {
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  const context = aiFindCustomerContext(data, payload, options.user || { role: 'Owner' });
  const fallback = aiPlanRules(data, payload, context);
  let plan = await openAiReplyPlan(data, payload, context, fallback);
  plan = prepareAiSafeLink(data, plan, context);
  const duplicateKey = String(options.sourceMessageId || payload.messageId || payload.externalId || '');
  const existing = duplicateKey && data.messages.find(item => item.aiSourceMessageId === duplicateKey && /AI draft|AI action/i.test(String(item.direction || '')));
  if (existing && !options.forceNew) return { plan, draft: existing, existing: true };
  const stamp = new Date();
  const draft = {
    id: 'msg-ai-' + Date.now() + '-' + Math.random().toString(16).slice(2, 7),
    date: stamp.toLocaleString('en-US'),
    createdAt: stamp.toISOString(),
    customer: plan.customer || context.customerName || 'Customer',
    phone: plan.phone || context.phone || payload.phone || '',
    email: context.email || payload.email || '',
    direction: plan.needsHuman ? 'AI action' : 'AI draft',
    channel: 'Star AI',
    deliveryChannel: payload.channel || payload.deliveryChannel || (context.phone ? 'SMS' : (context.email ? 'Email' : 'SMS')),
    template: plan.intent || 'AI reply',
    subject: plan.summary || 'AI reply manager',
    status: plan.needsHuman ? 'Human needed' : (plan.approvalRequired ? 'Needs approval' : (plan.canAutoSend ? 'Auto-ready' : 'Draft ready')),
    tone: plan.tone || 'blue',
    body: plan.reply,
    aiPlan: plan,
    aiSourceMessageId: duplicateKey,
    recurringPaymentId: plan.related && plan.related.recurringPaymentId || '',
    claimId: plan.related && plan.related.claimId || '',
    source: 'WheelsonAuto Star AI'
  };
  data.messages.unshift(draft);
  return { plan, draft, existing: false };
}
async function approveAiMessage(data, payload = {}) {
  const id = String(payload.draftId || payload.id || '').trim();
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  const draft = data.messages.find(item => item.id === id);
  if (!draft) throw new Error('AI draft was not found.');
  const plan = draft.aiPlan || {};
  if (plan.needsHuman) throw new Error('This AI item needs a human reply first.');
  if (plan.approvalRequired && payload.approveMoneyAction !== true) throw new Error('This AI item prepares a money or account change. Open the customer/payment action and approve it there.');
  const deliveryChannel = String(payload.channel || draft.deliveryChannel || (draft.email && !draft.phone ? 'Email' : 'SMS')).toLowerCase();
  const settings = messageSettings(data);
  const result = deliveryChannel === 'email'
    ? await sendProviderEmail(draft.email, draft.subject || 'WheelsonAuto message', draft.body, { customer: draft.customer, ai: true, messagingSettings: settings })
    : await sendProviderSms(draft.phone, draft.body, { customer: draft.customer, ai: true, messagingSettings: settings });
  const channel = result.channel || (deliveryChannel === 'email' ? 'Email' : 'SMS');
  const sent = {
    id: 'msg-ai-sent-' + Date.now(),
    externalId: result.externalId || '',
    date: new Date().toLocaleString('en-US'),
    createdAt: new Date().toISOString(),
    customer: draft.customer,
    phone: draft.phone,
    email: draft.email || '',
    direction: 'Outbound',
    channel,
    template: 'Star approved reply',
    subject: draft.subject || 'AI reply',
    status: result.sent ? (result.status || 'Sent') : (result.status || 'Ready to send'),
    tone: result.sent ? 'good' : 'warn',
    body: draft.body,
    provider: result.provider || (channel === 'Email' ? WOA_EMAIL_PROVIDER : MESSAGING_PROVIDER) || 'not_configured',
    source: result.sent ? ('Star AI + ' + channel + ' provider') : 'Star AI draft',
    aiApprovedAt: new Date().toISOString(),
    aiDraftId: draft.id
  };
  draft.status = result.sent ? 'Approved + sent' : 'Approved + saved';
  draft.tone = sent.tone;
  draft.approvedAt = sent.aiApprovedAt;
  data.messages.unshift(sent);
  return { sent, result, draft };
}
function emailKey(value) {
  return String(value || '').trim().toLowerCase();
}
function nameTokens(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2 && !['and', 'the', 'jr', 'sr'].includes(token));
}
function softNameMatch(a, b) {
  const ak = normKey(a), bk = normKey(b);
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  const ac = compactKey(ak), bc = compactKey(bk);
  if (ac.length >= 6 && bc.length >= 6 && (ac.includes(bc) || bc.includes(ac))) return true;
  const at = nameTokens(ak), bt = nameTokens(bk);
  if (!at.length || !bt.length) return false;
  const overlap = at.filter(token => bt.includes(token));
  return overlap.length >= Math.min(2, at.length, bt.length);
}
function weakValue(field, value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  if (field === 'customer') return ['Clover recurring customer', 'Unmatched Clover payment', 'Clover payment', 'Unknown customer'].includes(raw);
  if (field === 'vehicle') {
    const compactAmount = raw.replace(/[$,\s]/g, '');
    return ['No vehicle linked', 'Vehicle', 'WheelsonAuto recurring payment'].includes(raw)
      || /^\d+(\.\d{1,2})?$/.test(compactAmount);
  }
  return false;
}
function weakVehicleForCustomer(row) {
  if (!row) return true;
  if (weakValue('vehicle', row.vehicle)) return true;
  return !!(row.customer && row.vehicle && softNameMatch(row.customer, row.vehicle));
}
function fillBlank(target, patch, fields) {
  let changed = 0;
  fields.forEach(field => {
    const weak = field === 'vehicle' ? weakVehicleForCustomer(target) : weakValue(field, target[field]);
    if (weak && patch[field] !== undefined && patch[field] !== null && String(patch[field]).trim() !== '') {
      target[field] = patch[field];
      changed += 1;
    }
  });
  return changed;
}
function rowProfile(row = {}) {
  const vehicle = String(row.vehicle || row.name || '').trim();
  const plate = String(row.licensePlate || row.plate || row.stock || '').trim();
  return {
    customer: row.customer || row.name || '',
    phone: row.phone || row.phoneNumber || '',
    email: row.email || row.emailAddress || '',
    vehicle,
    vehicleId: row.vehicleId || (row.id && String(row.id).startsWith('veh-') ? row.id : ''),
    vin: row.vin || '',
    licensePlate: plate,
    plate,
    tempTag: row.tempTag || '',
    tracker: row.tracker || '',
    amount: row.amount || row.weeklyAmount || row.weekly || row.rate || row.price || '',
    weeklyAmount: row.weeklyAmount || row.weekly || row.amount || row.rate || row.price || '',
    frequency: row.frequency || '',
    cloverCustomerId: row.cloverCustomerId || '',
    cloverPaymentSource: row.cloverPaymentSource || '',
    cardLabel: row.cardLabel || '',
    cardLast4: row.cardLast4 || '',
    cardSavedAt: row.cardSavedAt || '',
    paymentSetup: row.paymentSetup || ''
  };
}
function sameProfileVehicle(a = {}, b = {}) {
  const vehicleIdA = String(a.vehicleId || '').trim();
  const vehicleIdB = String(b.vehicleId || '').trim();
  if (vehicleIdA && vehicleIdB && vehicleIdA === vehicleIdB) return true;
  const vinA = normKey(a.vin);
  const vinB = normKey(b.vin);
  if (vinA && vinB && vinA === vinB) return true;
  const plateA = normKey(a.licensePlate || a.plate);
  const plateB = normKey(b.licensePlate || b.plate);
  if (plateA && plateB && plateA === plateB) return true;
  const vehicleA = normKey(a.vehicle);
  const vehicleB = normKey(b.vehicle);
  return !!(vehicleA && vehicleB && vehicleA === vehicleB);
}
function enrichLinkedProfiles(data) {
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  data.contracts = Array.isArray(data.contracts) ? data.contracts : [];
  data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  data.integrations.clover.recurringPlanMembers = Array.isArray(data.integrations.clover.recurringPlanMembers) ? data.integrations.clover.recurringPlanMembers : [];
  const profiles = [];
  data.customers.forEach(row => profiles.push(rowProfile(row)));
  data.contracts.forEach(row => profiles.push(rowProfile(row)));
  data.recurringPayments.forEach(row => profiles.push(rowProfile(row)));
  data.integrations.clover.recurringPlanMembers.forEach(row => profiles.push(rowProfile(row)));
  data.vehicles.forEach(row => profiles.push(rowProfile({ ...row, customer: row.currentCustomer || row.customer || '', vehicle: vehicleNameFromParts(row), amount: row.rate || row.price || row.weeklyAmount || 0 })));
  const richness = item => ['customer', 'phone', 'email', 'vehicle', 'vin', 'licensePlate', 'tempTag', 'tracker', 'cloverPaymentSource', 'cardLast4'].reduce((sum, field) => sum + (weakValue(field, item[field]) ? 0 : 1), 0);
  const richest = candidates => candidates.filter(Boolean).sort((a, b) => richness(b) - richness(a))[0] || null;
  function bestMatch(row) {
    const profile = rowProfile(row);
    const cid = String(profile.cloverCustomerId || '').trim();
    if (cid) {
      const hit = richest(profiles.filter(item => String(item.cloverCustomerId || '').trim() === cid && (item.phone || item.email || item.vehicle || item.cloverPaymentSource)));
      if (hit) return hit;
    }
    const phone = phoneKey(profile.phone);
    if (phone) {
      const hit = richest(profiles.filter(item => phoneKey(item.phone) === phone && (item.customer || item.vehicle || item.email || item.cloverPaymentSource)));
      if (hit) return hit;
    }
    const email = emailKey(profile.email);
    if (email) {
      const hit = richest(profiles.filter(item => emailKey(item.email) === email && (item.customer || item.vehicle || item.phone || item.cloverPaymentSource)));
      if (hit) return hit;
    }
    if (profile.customer) {
      const exactName = richest(profiles.filter(item => item.customer && normKey(item.customer) === normKey(profile.customer) && (item.phone || item.email || item.vehicle || item.vin || item.cloverPaymentSource)));
      if (exactName) return exactName;
      return richest(profiles.filter(item => item.customer && softNameMatch(item.customer, profile.customer) && sameProfileVehicle(item, profile) && (item.phone || item.email || item.vehicle || item.vin || item.cloverPaymentSource)));
    }
    return null;
  }
  const fields = ['customer', 'phone', 'email', 'vehicle', 'vehicleId', 'vin', 'licensePlate', 'plate', 'tempTag', 'tracker', 'amount', 'weeklyAmount', 'frequency', 'cloverCustomerId', 'cloverPaymentSource', 'cardLabel', 'cardLast4', 'cardSavedAt', 'paymentSetup'];
  let recurringFilled = 0, customerFilled = 0, contractFilled = 0;
  [...data.recurringPayments, ...data.integrations.clover.recurringPlanMembers].forEach(row => {
    const match = bestMatch(row);
    if (match) recurringFilled += fillBlank(row, match, fields);
  });
  data.customers.forEach(row => {
    const match = bestMatch(row);
    if (match) customerFilled += fillBlank(row, match, fields);
  });
  data.contracts.forEach(row => {
    const match = bestMatch(row);
    if (match) contractFilled += fillBlank(row, match, ['phone', 'email', 'vehicleId', 'vin', 'licensePlate', 'plate', 'tempTag', 'tracker', 'cloverCustomerId']);
  });
  data.integrations.profileEnrichment = {
    updatedAt: new Date().toISOString(),
    recurringFieldsFilled: recurringFilled,
    customerFieldsFilled: customerFilled,
    contractFieldsFilled: contractFilled
  };
  return data.integrations.profileEnrichment;
}
function vehicleNameFromParts(row = {}) {
  return row.name || [row.year, row.make, row.model].filter(Boolean).join(' ').trim() || [row.year, row.makeModel].filter(Boolean).join(' ').trim() || 'Vehicle';
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

  const vehicleIndex = buildVehicleImportIndex(data.vehicles);
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
    let vehicleIndexMatch = vehicleImportIndexMatch(vehicleIndex, row);
    if (vehicleIndexMatch >= 0) {
      const existingVehicle = data.vehicles[vehicleIndexMatch];
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
      const vehicleId = nextUniqueVehicleId(data, 'veh-sheet-' + String(row.rowNumber).padStart(3, '0'), vehiclePatch);
      data.vehicles.push({ id: vehicleId, ...vehiclePatch });
      vehicleIndexMatch = data.vehicles.length - 1;
      addVehicleImportIndexKeys(vehicleIndex, data.vehicles[vehicleIndexMatch], vehicleIndexMatch);
    }
    const currentVehicle = vehicleIndexMatch >= 0 ? data.vehicles[vehicleIndexMatch] : null;
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
      if (currentVehicle) Object.assign(contractPatch, { vehicleId: currentVehicle.id, vin: currentVehicle.vin || row.vin || '', licensePlate: currentVehicle.plate || row.licensePlate || '', plate: currentVehicle.plate || row.licensePlate || '', tempTag: currentVehicle.tempTag || row.tempTag || '' });
      if (contractIndex.has(contractKey)) Object.assign(data.contracts[contractIndex.get(contractKey)], contractPatch);
      else {
        data.contracts.push({ id: 'WOA-SHEET-' + String(row.rowNumber).padStart(3, '0'), paidWeeks: 0, totalWeeks: 82, ...contractPatch });
        contractIndex.set(contractKey, data.contracts.length - 1);
      }
      contracts += 1;
    }

    recurringRows.forEach(recurring => {
      if (normKey(recurring.customer) !== customerKey) return;
      if (weakVehicleForCustomer(recurring)) recurring.vehicle = vehicleName;
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

  const profileEnrichment = enrichLinkedProfiles(data);
  data.integrations.vehicleSheet = { source: 'Vehicles  - Sheet1 (1).csv', importedAt: new Date().toISOString(), rows: rows.length, vehicles: rows.length, customers, contracts, recurringLinked, maintenanceImported, profileEnrichment };
  return data.integrations.vehicleSheet;
}
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) { res.writeHead(status, { 'Content-Type': type, ...extra }); res.end(body); }
function json(res, status, payload) { send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8'); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => { const i = part.indexOf('='); return [part.slice(0, i).trim(), part.slice(i + 1).trim()]; })); }
function cookieSecurityFlags(options = {}) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (PUBLIC_BASE_URL.startsWith('https://')) flags.push('Secure');
  if (Object.prototype.hasOwnProperty.call(options, 'maxAge')) flags.push('Max-Age=' + Number(options.maxAge || 0));
  return flags.join('; ');
}
function sessionSetCookie(name, value, options = {}) {
  return name + '=' + String(value || '') + '; ' + cookieSecurityFlags(options);
}
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
function organizationExists(data, organizationId) {
  const clean = String(organizationId || '').trim();
  if (!clean) return false;
  ensureBaseOrganization(data);
  return (data.organizations || []).some(item => item.id === clean);
}
function staffLoginUser(staff) {
  return { id: staff.id || ('staff-' + Date.now()), username: staff.username || staff.email || '', name: staff.name || staff.role || 'Staff', role: staff.role || 'Staff', homeView: staff.homeView || roleHome(staff.role), access: roleAccess(staff.role), organizationId: staff.organizationId || MAIN_ORG_ID, companyName: staff.companyName || 'WheelsonAuto' };
}
function userOrganizationId(user = {}) {
  return String(user.organizationId || MAIN_ORG_ID).trim() || MAIN_ORG_ID;
}
function rowOrganizationId(row = {}) {
  return String(row.organizationId || row.orgId || row.companyId || MAIN_ORG_ID).trim() || MAIN_ORG_ID;
}
function rowVisibleToUserOrganization(row, user) {
  if (isOwnerUser(user)) return true;
  return rowOrganizationId(row) === userOrganizationId(user);
}
function filterRowsForUserOrganization(rows, user) {
  if (!Array.isArray(rows) || isOwnerUser(user)) return rows;
  return rows.filter(row => rowVisibleToUserOrganization(row, user));
}
function mergeScopedCollection(currentRows, incomingRows, user) {
  if (!Array.isArray(incomingRows) || isOwnerUser(user)) return incomingRows;
  const keep = (Array.isArray(currentRows) ? currentRows : []).filter(row => !rowVisibleToUserOrganization(row, user));
  const owned = incomingRows.map(row => ({ ...row, organizationId: rowOrganizationId(row) === MAIN_ORG_ID && userOrganizationId(user) !== MAIN_ORG_ID ? userOrganizationId(user) : rowOrganizationId(row) }));
  return keep.concat(owned);
}
function findStaffByPin(data, pin) {
  const clean = String(pin || '').trim();
  if (!clean) return null;
  return (data.staffAccounts || []).find(staff => String(staff.status || 'Active').toLowerCase() !== 'disabled' && String(staff.pinHint || '').trim() === clean) || null;
}
function findStaffByLogin(data, username, password) {
  const cleanUser = normalizeLogin(username);
  if (!cleanUser || !password) return null;
  return (data.staffAccounts || []).find(staff => {
    if (String(staff.status || 'Active').toLowerCase() === 'disabled') return false;
    const names = [staff.username, staff.email, staff.name].map(normalizeLogin).filter(Boolean);
    return names.includes(cleanUser) && verifyPasswordRecord(password, staff);
  }) || null;
}
function cleanStaffAccountPayload(payload, existing = null) {
  const staff = {
    id: String(payload.id || existing && existing.id || ('staff-' + Date.now())).trim(),
    name: String(payload.name || '').trim(),
    username: normalizeLogin(payload.username || payload.email || existing && existing.username || ''),
    role: String(payload.role || existing && existing.role || 'Mechanic').trim(),
    organizationId: String(payload.organizationId || existing && existing.organizationId || MAIN_ORG_ID).trim(),
    companyName: String(payload.companyName || existing && existing.companyName || 'WheelsonAuto').trim(),
    phone: String(payload.phone || '').trim(),
    email: String(payload.email || '').trim(),
    status: String(payload.status || existing && existing.status || 'Active').trim(),
    pinHint: String(payload.pinHint || existing && existing.pinHint || '').trim(),
    notes: String(payload.notes || '').trim(),
    createdAt: existing && existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!staff.name) staff.name = staff.username || staff.role || 'Staff';
  if (!staff.username) staff.username = normalizeLogin(staff.email || staff.name.replace(/\s+/g, '.'));
  if (existing) {
    staff.passwordHash = existing.passwordHash || '';
    staff.passwordSalt = existing.passwordSalt || '';
    staff.passwordUpdatedAt = existing.passwordUpdatedAt || '';
  }
  const password = String(payload.password || '').trim();
  if (password) Object.assign(staff, createPasswordRecord(password));
  delete staff.password;
  return staff;
}
function staffStatusActive(row) {
  return String(row && row.status || 'Active').toLowerCase() !== 'disabled';
}
function safeCustomerAccount(account = {}) {
  const safe = { ...account };
  delete safe.passwordHash;
  delete safe.passwordSalt;
  delete safe.password;
  return safe;
}
function customerLoginUser(account) {
  return {
    id: account.id || ('customer-' + Date.now()),
    username: account.username || account.email || '',
    name: account.name || account.customer || 'Customer',
    customer: account.customer || account.name || '',
    role: 'Customer',
    access: 'Customer portal',
    organizationId: account.organizationId || MAIN_ORG_ID,
    customerId: account.customerId || '',
    contractId: account.contractId || '',
    recurringPaymentId: account.recurringPaymentId || '',
    vehicleId: account.vehicleId || '',
    cloverCustomerId: account.cloverCustomerId || '',
    phone: account.phone || '',
    email: account.email || ''
  };
}
function findCustomerAccountByLogin(data, username, password) {
  const cleanUser = normalizeLogin(username);
  if (!cleanUser || !password) return null;
  return (data.customerAccounts || []).find(account => {
    if (!staffStatusActive(account)) return false;
    const names = [account.username, account.email, account.phone, account.name, account.customer].map(normalizeLogin).filter(Boolean);
    return names.includes(cleanUser) && verifyPasswordRecord(password, account);
  }) || null;
}
function cleanCustomerAccountPayload(payload, existing = null) {
  const name = String(payload.name || payload.customer || existing && existing.name || '').trim();
  const customer = String(payload.customer || payload.name || existing && existing.customer || name).trim();
  const data = payload && payload.__data || null;
  const customerKey = normKey(customer || name);
  const matchedCustomer = data && (data.customers || []).find(row => normKey(row.name || row.customer) === customerKey || phoneKey(row.phone) && phoneKey(row.phone) === phoneKey(payload.phone || existing && existing.phone || '') || emailKey(row.email) && emailKey(row.email) === emailKey(payload.email || existing && existing.email || '')) || null;
  const matchedContract = data && (data.contracts || []).find(row => normKey(row.customer || row.name) === customerKey || phoneKey(row.phone) && phoneKey(row.phone) === phoneKey(payload.phone || existing && existing.phone || '') || emailKey(row.email) && emailKey(row.email) === emailKey(payload.email || existing && existing.email || '')) || null;
  const matchedRecurring = data && allRecurringRows(data).find(row => normKey(row.customer || row.name) === customerKey || phoneKey(row.phone) && phoneKey(row.phone) === phoneKey(payload.phone || existing && existing.phone || '') || emailKey(row.email) && emailKey(row.email) === emailKey(payload.email || existing && existing.email || '')) || null;
  const matchedVehicle = data && (data.vehicles || []).find(row => normKey(row.currentCustomer) === customerKey || row.id === (payload.vehicleId || existing && existing.vehicleId || '') || row.id === (matchedRecurring && matchedRecurring.vehicleId || '') || row.id === (matchedCustomer && matchedCustomer.vehicleId || '')) || null;
  const account = {
    id: String(payload.id || existing && existing.id || ('customer-login-' + Date.now())).trim(),
    name: name || customer || 'Customer',
    customer: customer || name || 'Customer',
    username: normalizeLogin(payload.username || payload.email || existing && existing.username || ''),
    phone: String(payload.phone || existing && existing.phone || '').trim(),
    email: String(payload.email || existing && existing.email || '').trim(),
    status: String(payload.status || existing && existing.status || 'Active').trim(),
    organizationId: String(payload.organizationId || existing && existing.organizationId || MAIN_ORG_ID).trim(),
    customerId: String(payload.customerId || existing && existing.customerId || matchedCustomer && matchedCustomer.id || '').trim(),
    contractId: String(payload.contractId || existing && existing.contractId || matchedContract && matchedContract.id || '').trim(),
    recurringPaymentId: String(payload.recurringPaymentId || existing && existing.recurringPaymentId || matchedRecurring && matchedRecurring.id || '').trim(),
    vehicleId: String(payload.vehicleId || existing && existing.vehicleId || matchedVehicle && matchedVehicle.id || '').trim(),
    cloverCustomerId: String(payload.cloverCustomerId || existing && existing.cloverCustomerId || matchedRecurring && matchedRecurring.cloverCustomerId || matchedCustomer && matchedCustomer.cloverCustomerId || '').trim(),
    notes: String(payload.notes || existing && existing.notes || '').trim(),
    createdAt: existing && existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!account.username) account.username = normalizeLogin(account.email || account.phone || account.name.replace(/\s+/g, '.'));
  if (existing) {
    account.passwordHash = existing.passwordHash || '';
    account.passwordSalt = existing.passwordSalt || '';
    account.passwordUpdatedAt = existing.passwordUpdatedAt || '';
  }
  const password = String(payload.password || '').trim();
  if (password) {
    Object.assign(account, createPasswordRecord(password));
    account.passwordResetStatus = 'Reset complete';
    account.passwordResetResolvedAt = new Date().toISOString();
  } else {
    account.passwordResetRequestedAt = existing && existing.passwordResetRequestedAt || '';
    account.passwordResetStatus = existing && existing.passwordResetStatus || '';
    account.passwordResetIdentity = existing && existing.passwordResetIdentity || '';
    account.passwordResetResolvedAt = existing && existing.passwordResetResolvedAt || '';
  }
  delete account.password;
  return account;
}
function cleanOrganizationPayload(payload, existing = null) {
  const now = new Date().toISOString();
  const requestedScope = String(payload.dataScope || existing && existing.dataScope || 'Shared owner account').trim();
  const dataScope = WOA_MULTI_TENANT_ENABLED ? requestedScope : 'Shared owner account';
  return {
    id: String(payload.id || existing && existing.id || ('org-' + Date.now())).trim(),
    name: String(payload.name || existing && existing.name || 'New company').trim(),
    type: String(payload.type || existing && existing.type || 'Store / location').trim(),
    status: String(payload.status || existing && existing.status || 'Active').trim(),
    plan: String(payload.plan || existing && existing.plan || 'Internal').trim(),
    primaryAdmin: String(payload.primaryAdmin || payload.admin || existing && existing.primaryAdmin || '').trim(),
    fleetCount: Number(payload.fleetCount || existing && existing.fleetCount || 0),
    parentOrganizationId: String(payload.parentOrganizationId || existing && existing.parentOrganizationId || '').trim(),
    dataScope,
    billingOwner: String(payload.billingOwner || existing && existing.billingOwner || 'WheelsonAuto').trim(),
    notes: String(payload.notes || existing && existing.notes || '').trim(),
    createdAt: existing && existing.createdAt || payload.createdAt || now,
    updatedAt: now
  };
}
function isOwnerUser(user) {
  return String(user && user.role || '').toLowerCase() === 'owner';
}
function apiAllowedForUser(user, pathname) {
  if (isOwnerUser(user)) return true;
  const role = String(user && user.role || '').toLowerCase();
  const ownerOnly = ['/api/integrations', '/api/sync', '/api/import', '/api/woa-autopay', '/api/api-providers', '/api/staff-accounts', '/api/customer-accounts', '/api/organizations', '/api/notifications'];
  if (ownerOnly.some(prefix => pathname.startsWith(prefix))) return false;
  if (role === 'mechanic' && pathname.startsWith('/api/messages')) return false;
  if (role === 'mechanic' && pathname.startsWith('/api/reports')) return false;
  if (role === 'mechanic' && pathname.startsWith('/api/system/health')) return false;
  if ((role === 'mechanic' || role === 'manager') && ['/api/payment-links', '/api/recurring-payments', '/api/card-setup-requests'].some(prefix => pathname.startsWith(prefix))) return false;
  return true;
}
function stateForUserWrite(current, incoming, user) {
  if (isOwnerUser(user)) return preserveStaffLoginSecrets(current, incoming);
  const role = String(user && user.role || '').toLowerCase();
  const allowed = role === 'mechanic'
    ? ['maintenance', 'vehicles']
    : role === 'manager'
      ? ['vehicles', 'applications', 'customers', 'contracts', 'maintenance', 'claims', 'messages', 'tasks', 'documents', 'websiteLeads']
      : ['messages'];
  const next = { ...current };
  allowed.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) return;
    next[key] = Array.isArray(incoming[key]) ? mergeScopedCollection(current[key], incoming[key], user) : incoming[key];
  });
  next.lastStaffSaveAt = new Date().toISOString();
  next.lastStaffSaveBy = user && (user.name || user.role) || 'Staff';
  return next;
}
function auditChangedSections(current = {}, next = {}) {
  const keys = ['recurringPayments', 'payments', 'customers', 'contracts', 'vehicles', 'maintenance', 'claims', 'messages', 'tasks', 'documents', 'applications', 'staffAccounts', 'customerAccounts', 'organizations', 'dailyCloseouts'];
  const details = [];
  keys.forEach(key => {
    if (JSON.stringify(current[key] || []) === JSON.stringify(next[key] || [])) return;
    const beforeRows = Array.isArray(current[key]) ? current[key] : [];
    const afterRows = Array.isArray(next[key]) ? next[key] : [];
    details.push(key + ' ' + beforeRows.length + '->' + afterRows.length);
    const beforeMap = auditRecordMap(beforeRows);
    const afterMap = auditRecordMap(afterRows);
    afterMap.forEach((row, id) => {
      if (!beforeMap.has(id)) details.push(key + ' added: ' + auditRecordLabel(row));
    });
    beforeMap.forEach((row, id) => {
      if (!afterMap.has(id)) details.push(key + ' removed: ' + auditRecordLabel(row));
    });
    afterMap.forEach((row, id) => {
      const old = beforeMap.get(id);
      if (!old || JSON.stringify(old) === JSON.stringify(row)) return;
      const changed = auditChangedFields(old, row);
      details.push(key + ' updated: ' + auditRecordLabel(row) + (changed ? ' (' + changed + ')' : ''));
    });
  });
  return details.slice(0, 24);
}
function auditRecordMap(rows = []) {
  const map = new Map();
  rows.forEach((row, index) => {
    const id = String(row && (row.id || row.recurringPaymentId || row.paymentRequestId || row.cloverPaymentId || row.externalId || row.username || row.email || row.phone || row.name || row.customer) || 'row-' + index).trim();
    map.set(id || ('row-' + index), row || {});
  });
  return map;
}
function auditRecordLabel(row = {}) {
  return [
    row.customer || row.name || row.username || row.email || row.phone || row.id || 'record',
    row.vehicle || [row.year, row.make, row.model].filter(Boolean).join(' '),
    row.vin ? 'VIN ' + row.vin : '',
    row.plate || row.licensePlate || row.stock ? 'Tag ' + (row.plate || row.licensePlate || row.stock) : '',
    row.status || row.stage || row.type || row.role || ''
  ].filter(Boolean).join(' / ').slice(0, 180);
}
function auditChangedFields(before = {}, after = {}) {
  const fields = ['status', 'stage', 'customer', 'name', 'vehicle', 'vehicleId', 'vin', 'plate', 'licensePlate', 'tracker', 'amount', 'weeklyAmount', 'weekly', 'frequency', 'nextRun', 'chargeTime', 'paymentDay', 'currentCustomer', 'phone', 'email', 'role', 'organizationId'];
  return fields.filter(field => JSON.stringify(before[field] || '') !== JSON.stringify(after[field] || '')).slice(0, 8).join(', ');
}
function appendAuditLog(data, user, action, details = []) {
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  const safeDetails = (details || []).slice(0, 12).map(item => String(item || '').replace(/token|password|secret|source/ig, '[redacted]').slice(0, 180));
  data.auditLogs.unshift({
    id: 'audit-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    at: new Date().toISOString(),
    action: String(action || 'State update').slice(0, 80),
    user: user && (user.name || user.username || user.role) || 'Unknown user',
    role: user && user.role || 'Unknown',
    organizationId: userOrganizationId(user),
    companyName: user && user.companyName || 'WheelsonAuto',
    details: safeDetails.join(' | ') || 'No section-level change detected'
  });
  data.auditLogs = data.auditLogs.slice(0, 250);
}
function preserveStaffLoginSecrets(current, incoming) {
  const next = { ...(incoming || {}) };
  if (current.security && current.security.ownerLogin) {
    next.security = next.security || {};
    next.security.ownerLogin = {
      ...(next.security.ownerLogin || {}),
      passwordHash: (next.security.ownerLogin && next.security.ownerLogin.passwordHash) || current.security.ownerLogin.passwordHash || '',
      passwordSalt: (next.security.ownerLogin && next.security.ownerLogin.passwordSalt) || current.security.ownerLogin.passwordSalt || '',
      passwordUpdatedAt: (next.security.ownerLogin && next.security.ownerLogin.passwordUpdatedAt) || current.security.ownerLogin.passwordUpdatedAt || '',
      username: (next.security.ownerLogin && next.security.ownerLogin.username) || current.security.ownerLogin.username || LOGIN_USERNAME || 'admin'
    };
  }
  if (Array.isArray(next.staffAccounts)) {
    const existingById = new Map((current.staffAccounts || []).map(staff => [staff.id, staff]));
    next.staffAccounts = next.staffAccounts.map(staff => {
      const old = existingById.get(staff.id) || {};
      return {
        ...staff,
        passwordHash: staff.passwordHash || old.passwordHash || '',
        passwordSalt: staff.passwordSalt || old.passwordSalt || '',
        passwordUpdatedAt: staff.passwordUpdatedAt || old.passwordUpdatedAt || ''
      };
    });
  }
  if (Array.isArray(next.customerAccounts)) {
    const existingById = new Map((current.customerAccounts || []).map(account => [account.id, account]));
    next.customerAccounts = next.customerAccounts.map(account => {
      const old = existingById.get(account.id) || {};
      return {
        ...account,
        passwordHash: account.passwordHash || old.passwordHash || '',
        passwordSalt: account.passwordSalt || old.passwordSalt || '',
        passwordUpdatedAt: account.passwordUpdatedAt || old.passwordUpdatedAt || ''
      };
    });
  }
  return next;
}
function redactStaffSecrets(data) {
  const safe = JSON.parse(JSON.stringify(data || {}));
  safe.staffAccounts = (safe.staffAccounts || []).map(staff => {
    delete staff.passwordHash;
    delete staff.passwordSalt;
    return staff;
  });
  safe.customerAccounts = (safe.customerAccounts || []).map(safeCustomerAccount);
  if (safe.security && safe.security.ownerLogin) {
    delete safe.security.ownerLogin.passwordHash;
    delete safe.security.ownerLogin.passwordSalt;
  }
  return safe;
}
function stateForUserRead(data, user) {
  const safe = redactStaffSecrets(data);
  if (isOwnerUser(user)) return safe;
  const role = String(user && user.role || '').toLowerCase();
  delete safe.security;
  delete safe.apiProviders;
  delete safe.staffAccounts;
  delete safe.customerAccounts;
  delete safe.auditLogs;
  if (safe.integrations) {
    delete safe.integrations.clover;
    delete safe.integrations.apiProviders;
  }
  Object.keys(safe).forEach(key => {
    if (!Array.isArray(safe[key])) return;
    safe[key] = key === 'organizations'
      ? safe[key].filter(row => String(row.id || '') === userOrganizationId(user))
      : filterRowsForUserOrganization(safe[key], user);
  });
  if (role === 'mechanic') {
    const mechanic = {};
    ['business', 'vehicles', 'maintenance', 'claims', 'customers', 'contracts', 'tasks', 'documents', 'organizations'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(safe, key)) mechanic[key] = safe[key];
    });
    mechanic.integrations = {
      messaging: {
        provider: 'not_configured',
        configured: false,
        voiceMode: 'Messages are available to admin and manager accounts only.'
      }
    };
    return mechanic;
  }
  return safe;
}
async function readBody(req) { let body = ''; for await (const chunk of req) body += chunk; return body; }
function escapeHtml(value) { return String(value || '').replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;' }[c])); }
function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}
function passwordHash(password, salt) {
  return crypto.createHash('sha256').update(String(salt || '') + ':' + String(password || '')).digest('hex');
}
function passwordHashStrong(password, salt, iterations = 310000) {
  return 'pbkdf2$' + iterations + '$' + crypto.pbkdf2Sync(String(password || ''), String(salt || ''), iterations, 32, 'sha256').toString('hex');
}
function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { passwordSalt: salt, passwordHash: passwordHashStrong(password, salt), passwordUpdatedAt: new Date().toISOString() };
}
function secureCompare(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function verifyPasswordRecord(password, record = {}) {
  if (!password) return false;
  if (record.passwordHash && record.passwordSalt && String(record.passwordHash).startsWith('pbkdf2$')) {
    const parts = String(record.passwordHash).split('$');
    const iterations = Math.max(100000, Number(parts[1] || 310000));
    return secureCompare(passwordHashStrong(password, record.passwordSalt, iterations), record.passwordHash);
  }
  if (record.passwordHash && record.passwordSalt) return secureCompare(passwordHash(password, record.passwordSalt), record.passwordHash);
  if (record.passwordHash && LOGIN_PASSWORD_SALT) return secureCompare(passwordHash(password, LOGIN_PASSWORD_SALT), record.passwordHash);
  if (record.passwordHash && !record.passwordSalt) return secureCompare(String(password), record.passwordHash);
  return false;
}
function ownerLoginMatches(username, password, pin) {
  if (LOGIN_PIN && pin && secureCompare(pin, LOGIN_PIN)) return true;
  if (!password) return false;
  const wantedUser = normalizeLogin(LOGIN_USERNAME || 'admin');
  const enteredUser = normalizeLogin(username || '');
  if (wantedUser && enteredUser && enteredUser !== wantedUser) return false;
  if (LOGIN_PASSWORD && secureCompare(password, LOGIN_PASSWORD)) return true;
  if (LOGIN_PASSWORD_HASH && verifyPasswordRecord(password, { passwordHash: LOGIN_PASSWORD_HASH, passwordSalt: LOGIN_PASSWORD_SALT })) return true;
  return !LOGIN_PASSWORD && !LOGIN_PASSWORD_HASH && LOGIN_PIN && secureCompare(password, LOGIN_PIN);
}
function storedOwnerLoginMatches(data, username, password) {
  const security = data && data.security || {};
  const owner = security.ownerLogin || {};
  if (!owner.passwordHash || !password) return false;
  const wantedUser = normalizeLogin(owner.username || LOGIN_USERNAME || 'admin');
  const enteredUser = normalizeLogin(username || '');
  if (wantedUser && enteredUser && enteredUser !== wantedUser) return false;
  return verifyPasswordRecord(password, owner);
}
function passwordMatchesCurrentUser(data, user, password) {
  if (!user || !password) return false;
  if (isOwnerUser(user)) return ownerLoginMatches(user.username || LOGIN_USERNAME || 'admin', password, password) || storedOwnerLoginMatches(data, user.username || LOGIN_USERNAME || 'admin', password);
  const staff = (data.staffAccounts || []).find(item => item.id === user.id);
  return !!(staff && verifyPasswordRecord(password, staff));
}
function loginPage(message = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Login</title>' + BROWSER_ICON_LINKS + CSS_LINK + '</head><body><main class="login-page"><form class="login-card" method="POST" action="/login"><a class="login-logo-link" href="https://www.wheelsonauto.com/"><img class="login-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"></a><div class="eyebrow">Secure access</div><h1>WheelsonAuto Portal</h1><p>Owner, manager, and mechanic accounts each open the right workspace.</p>' + (message ? '<p class="err">' + escapeHtml(message) + '</p>' : '') + '<label>Username<input name="username" autocomplete="username" autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><div class="login-divider"><span>or</span></div><label>Access PIN<input name="pin" type="password" autocomplete="one-time-code"></label><button>Sign in</button><div class="login-pin">Use username/password for staff accounts. Owner PIN still works as a backup so you do not get locked out.</div></form></main></body></html>';
}
function customerSessionCookie(account) {
  const payload = Buffer.from(JSON.stringify(customerLoginUser(account)), 'utf8').toString('base64url');
  return SESSION_VALUE + '.customer.' + payload;
}
function customerSessionUser(req) {
  const raw = cookies(req).woa_customer_session || '';
  if (!raw.startsWith(SESSION_VALUE + '.customer.')) return null;
  try {
    const body = JSON.parse(Buffer.from(raw.slice((SESSION_VALUE + '.customer.').length), 'base64url').toString('utf8'));
    return body && body.role === 'Customer' ? body : null;
  } catch {
    return null;
  }
}
function customerLoginPage(message = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Customer Login</title>' + BROWSER_ICON_LINKS + CSS_LINK + '</head><body><main class="login-page customer-login-page"><form class="login-card" method="POST" action="/customer/login"><a class="login-logo-link" href="https://www.wheelsonauto.com/"><img class="login-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"></a><div class="eyebrow">Customer access</div><h1>My WheelsonAuto</h1><p>View your vehicle, payment schedule, service reminders, and account messages.</p>' + (message ? '<p class="err">' + escapeHtml(message) + '</p>' : '') + '<label>Username or email<input name="username" autocomplete="username" autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button><div class="login-pin">This is for customer accounts only. Staff should use the main WheelsonAuto Portal login.</div><a class="btn" href="/customer/forgot" style="margin-top:10px;text-align:center">Forgot password?</a><a class="btn" href="/login" style="margin-top:10px;text-align:center">Staff login</a></form></main></body></html>';
}
function customerForgotPage(message = '') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Customer Help</title>' + BROWSER_ICON_LINKS + CSS_LINK + '</head><body><main class="login-page customer-login-page"><form class="login-card" method="POST" action="/customer/forgot"><a class="login-logo-link" href="https://www.wheelsonauto.com/"><img class="login-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"></a><div class="eyebrow">Customer help</div><h1>Reset access</h1><p>Send the office a secure request. We will verify the account before changing any login.</p>' + (message ? '<p class="err">' + escapeHtml(message) + '</p>' : '') + '<label>Name, username, phone, or email<input name="identity" autocomplete="username" autofocus></label><button>Request help</button><div class="login-pin">For security, passwords are changed by WheelsonAuto after account verification.</div><a class="btn" href="/customer/login" style="margin-top:10px;text-align:center">Back to customer login</a></form></main></body></html>';
}
function findCustomerAccountByIdentity(data, identity) {
  const key = normalizeLogin(identity);
  const phone = phoneKey(identity);
  const name = normKey(identity);
  if (!key && !phone && !name) return null;
  return (data.customerAccounts || []).find(account => {
    if (!staffStatusActive(account)) return false;
    const values = [account.username, account.email, account.name, account.customer].map(normalizeLogin).filter(Boolean);
    if (key && values.includes(key)) return true;
    if (phone && phoneKey(account.phone) === phone) return true;
    return !!(name && [account.name, account.customer].some(value => softNameMatch(value, name)));
  }) || null;
}
function moneyText(value) {
  const amount = Number(value || 0);
  return '$' + (Number.isFinite(amount) ? amount : 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function stripPrivateCustomerFields(row = {}) {
  const safe = { ...row };
  ['passwordHash', 'passwordSalt', 'cloverPaymentSource', 'paymentSource', 'paymentSourceId', 'paymentToken', 'sourceToken', 'cardToken', 'token', 'raw', 'response', 'internalNotes', 'privateNotes', 'secret', 'apiKey'].forEach(key => delete safe[key]);
  return safe;
}
function dataScopedToOrganization(data = {}, organizationId = MAIN_ORG_ID) {
  const orgId = String(organizationId || MAIN_ORG_ID).trim() || MAIN_ORG_ID;
  const scoped = { ...data, integrations: { ...((data && data.integrations) || {}) } };
  Object.keys(scoped).forEach(key => {
    if (Array.isArray(scoped[key])) scoped[key] = scoped[key].filter(row => rowOrganizationId(row) === orgId);
  });
  scoped.integrations.clover = { ...(((data.integrations || {}).clover) || {}) };
  if (Array.isArray(scoped.integrations.clover.recurringPlanMembers)) {
    scoped.integrations.clover.recurringPlanMembers = scoped.integrations.clover.recurringPlanMembers.filter(row => rowOrganizationId(row) === orgId);
  }
  return scoped;
}
function customerPortalIdentity(account = {}, context = {}) {
  const recurring = context.recurring || {};
  const customer = context.customer || {};
  const contract = context.contract || {};
  const vehicle = context.vehicle || {};
  const names = [account.customer, account.name, context.customerName, recurring.customer, customer.name, customer.customer, contract.customer, vehicle.currentCustomer].map(normKey).filter(Boolean);
  const phones = [account.phone, context.phone, recurring.phone, customer.phone, contract.phone].map(phoneKey).filter(Boolean);
  const emails = [account.email, context.email, recurring.email, customer.email, contract.email].map(emailKey).filter(Boolean);
  const ids = {
    customerId: account.customerId || customer.id || '',
    contractId: account.contractId || contract.id || '',
    recurringPaymentId: account.recurringPaymentId || recurring.id || '',
    vehicleId: account.vehicleId || recurring.vehicleId || customer.vehicleId || contract.vehicleId || vehicle.id || '',
    cloverCustomerId: account.cloverCustomerId || recurring.cloverCustomerId || customer.cloverCustomerId || ''
  };
  return { names: [...new Set(names)], phones: [...new Set(phones)], emails: [...new Set(emails)], ids };
}
function customerPortalRecordMatches(row = {}, identity = {}, kind = '') {
  const ids = identity.ids || {};
  if (kind === 'customer' && ids.customerId && row.id === ids.customerId) return true;
  if (kind === 'contract' && ids.contractId && row.id === ids.contractId) return true;
  if (kind === 'recurring' && ids.recurringPaymentId && row.id === ids.recurringPaymentId) return true;
  if (kind === 'vehicle' && ids.vehicleId && row.id === ids.vehicleId) return true;
  if (ids.vehicleId && row.vehicleId === ids.vehicleId) return true;
  if (ids.recurringPaymentId && row.recurringPaymentId === ids.recurringPaymentId) return true;
  if (ids.cloverCustomerId && String(row.cloverCustomerId || row.customerId || '') === String(ids.cloverCustomerId)) return true;
  const rowPhone = phoneKey(row.phone || row.from || row.to || '');
  if (rowPhone && identity.phones.includes(rowPhone)) return true;
  const rowEmail = emailKey(row.email || row.from || row.to || '');
  if (rowEmail && identity.emails.includes(rowEmail)) return true;
  const rowNames = [row.customer, row.name, row.currentCustomer, row.cardholderName, row.customerName].map(normKey).filter(Boolean);
  return rowNames.some(name => identity.names.some(wanted => softNameMatch(name, wanted)));
}
function customerPortalDocuments(scopedData = {}, identity = {}, payments = []) {
  const visibleDocs = (scopedData.documents || []).filter(row => {
    if (!customerPortalRecordMatches(row, identity, 'document')) return false;
    if (row.customerVisible === true || row.portalVisible === true) return true;
    const visibility = String(row.visibility || '').toLowerCase();
    return visibility === 'customer' || visibility === 'customer portal' || visibility === 'customer visible';
  }).map(row => stripPrivateCustomerFields({
    ...row,
    kind: 'Document',
    date: row.date || row.createdAt || row.expires || row.due || '',
    title: row.title || row.type || 'Document'
  }));
  const receipts = (payments || []).filter(row => {
    const status = String(row.status || '').toLowerCase();
    return status === 'paid' || status.indexOf('paid outside app') >= 0;
  }).map(row => stripPrivateCustomerFields({
    id: 'receipt-' + (row.id || row.cloverPaymentId || row.createdAt || Date.now()),
    kind: 'Receipt',
    type: 'Payment receipt',
    title: 'Payment receipt',
    customer: row.customer || '',
    vehicle: row.vehicle || '',
    vehicleId: row.vehicleId || '',
    vin: row.vin || '',
    licensePlate: row.licensePlate || row.plate || '',
    amount: row.amount || 0,
    method: row.method || row.type || row.source || 'Payment',
    status: row.status || 'Paid',
    date: row.date || row.createdAt || '',
    source: row.source || 'WheelsonAuto',
    notes: row.requiresVerification ? 'Reported by customer; office verification required.' : 'Payment record linked to this customer.'
  }));
  const seen = new Set();
  return visibleDocs.concat(receipts).filter(row => {
    const key = String(row.id || row.kind + row.type + row.date + row.amount);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}
function customerPortalState(data, account) {
  const scopedData = dataScopedToOrganization(data, account.organizationId || MAIN_ORG_ID);
  enrichLinkedProfiles(scopedData);
  const context = aiFindCustomerContext(scopedData, {
    customer: account.customer || account.name,
    phone: account.phone,
    email: account.email,
    recurringPaymentId: account.recurringPaymentId,
    id: account.recurringPaymentId
  });
  const identity = customerPortalIdentity(account, context);
  const vehicles = (scopedData.vehicles || []).filter(row => customerPortalRecordMatches(row, identity, 'vehicle'));
  const customers = (scopedData.customers || []).filter(row => customerPortalRecordMatches(row, identity, 'customer'));
  const contracts = (scopedData.contracts || []).filter(row => customerPortalRecordMatches(row, identity, 'contract'));
  const recurringPayments = allRecurringRows(scopedData).filter(row => customerPortalRecordMatches(row, identity, 'recurring'));
  const payments = (scopedData.payments || []).filter(row => customerPortalRecordMatches(row, identity, 'payment')).slice(0, 20);
  const maintenance = (scopedData.maintenance || []).filter(row => customerPortalRecordMatches(row, identity, 'maintenance')).slice(0, 20);
  const claims = (scopedData.claims || []).filter(row => customerPortalRecordMatches(row, identity, 'claim')).slice(0, 20);
  const messages = (scopedData.messages || []).filter(row => customerPortalRecordMatches(row, identity, 'message')).slice(0, 20);
  const paymentRequests = (scopedData.paymentRequests || []).filter(row => customerPortalRecordMatches(row, identity, 'paymentRequest')).slice(0, 10);
  const documents = customerPortalDocuments(scopedData, identity, payments);
  const primaryRecurring = recurringPayments[0] || context.recurring || {};
  const namedVehicle = (scopedData.vehicles || []).find(row => [primaryRecurring.vehicle, customers[0] && customers[0].vehicle, contracts[0] && contracts[0].vehicle, context.vehicleName].some(name => name && normKey(vehicleNameFromParts(row)) === normKey(name))) || {};
  const primaryVehicle = vehicles[0] || namedVehicle || context.vehicle || {};
  return {
    account: safeCustomerAccount(account),
    summary: aiContextSummary({ ...context, recurring: primaryRecurring, vehicle: primaryVehicle }),
    customer: stripPrivateCustomerFields(customers[0] || context.customer || {}),
    contract: stripPrivateCustomerFields(contracts[0] || context.contract || {}),
    recurring: stripPrivateCustomerFields(primaryRecurring),
    vehicle: stripPrivateCustomerFields(primaryVehicle),
    vehicles: vehicles.map(stripPrivateCustomerFields),
    payments: payments.map(stripPrivateCustomerFields),
    maintenance: maintenance.map(stripPrivateCustomerFields),
    claims: claims.map(stripPrivateCustomerFields),
    messages: messages.map(stripPrivateCustomerFields),
    documents: documents.map(stripPrivateCustomerFields),
    paymentRequests: paymentRequests.map(stripPrivateCustomerFields),
    generatedAt: new Date().toISOString()
  };
}
function customerPortalList(rows, empty, render) {
  return rows && rows.length ? rows.map(render).join('') : '<div class="customer-empty">' + escapeHtml(empty) + '</div>';
}
function customerPortalActionForm(action, buttonText, note, className = '') {
  return '<form method="POST" action="' + escapeHtml(action) + '" class="' + escapeHtml(className || 'customer-action-form') + '"><button class="btn primary" type="submit">' + escapeHtml(buttonText) + '</button>' + (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</form>';
}
function customerPortalHtml(account, state) {
  const vehicle = state.vehicle || {};
  const recurring = state.recurring || {};
  const summary = state.summary || {};
  const amount = recurring.amount || recurring.weeklyAmount || state.customer.weeklyAmount || vehicle.rate || 0;
  const paymentStatus = recurring.status || summary.paymentStatus || 'Not scheduled';
  const vehicleTitle = summary.vehicle || vehicleNameFromParts(vehicle) || 'Vehicle not linked yet';
  const tag = summary.tag || vehicle.plate || vehicle.stock || recurring.licensePlate || '';
  const customerName = account.name || account.customer || summary.customer || 'Customer';
  const portalMessageForm = '<form method="POST" action="/customer/message" class="customer-message-form"><label>Message WheelsonAuto<textarea name="body" maxlength="1200" placeholder="Type a payment, service, card, toll, or account question..."></textarea></label><button class="btn primary" type="submit">Send message</button><small>Messages arrive in the WheelsonAuto inbox for admin/manager follow-up.</small></form>';
  const portalPaidOutsideForm = '<form method="POST" action="/customer/paid-outside" class="customer-message-form customer-paid-outside-form"><label>Report payment made outside app<input name="amount" type="number" step="0.01" min="0" value="' + escapeHtml(amount || '') + '"></label><label>Method<select name="method"><option>Cash</option><option>Zelle</option><option>Cash App</option><option>Money order</option><option>Clover terminal</option><option>Other</option></select></label><label>Payment date<input name="paidDate" type="date" value="' + escapeHtml(localDateKey()) + '"></label><label>Proof link / photo note<input name="proofUrl" maxlength="500" placeholder="Receipt photo link, screenshot note, or who accepted it"></label><label>Note / proof placeholder<textarea name="note" maxlength="1200" placeholder="Receipt number, who accepted it, screenshot note, or any proof detail..."></textarea></label><button class="btn primary" type="submit">Report payment</button><small>This alerts WheelsonAuto to verify before marking the account paid.</small></form>';
  const portalServiceForm = '<form method="POST" action="/customer/service-request" class="customer-message-form customer-service-form"><label>Request service<select name="type"><option>Monthly inspection / oil change</option><option>Repair issue</option><option>Tire / brake concern</option><option>Warning light</option><option>Other service request</option></select></label><label>Preferred date<input name="preferredDate" type="date"></label><label>Proof link / photo note<input name="proofUrl" maxlength="500" placeholder="Photo link, dashboard light photo note, or where proof was sent"></label><label>Notes<textarea name="notes" maxlength="1200" placeholder="Tell us what is going on with the vehicle..."></textarea></label><button class="btn primary" type="submit">Send service request</button><small>This creates a WheelsonAuto service item connected to your vehicle and customer file.</small></form>';
  const portalIssueForm = '<form method="POST" action="/customer/issue-report" class="customer-message-form customer-issue-form"><label>Report toll, ticket, damage, or issue<select name="type"><option>Toll / E-ZPass notice</option><option>Ticket / violation</option><option>Damage</option><option>Insurance / claim</option><option>Tracker issue</option><option>Reimbursement question</option><option>Other issue</option></select></label><label>Notice / incident date<input name="incidentDate" type="date" value="' + escapeHtml(localDateKey()) + '"></label><label>Amount, if shown<input name="amount" type="number" step="0.01" min="0" value="0"></label><label>Proof link / photo note<input name="proofUrl" maxlength="500" placeholder="Notice photo/link, receipt, damage photo note, or where proof was sent"></label><label>Note / proof placeholder<textarea name="notes" maxlength="1200" placeholder="Notice number, location, photo note, receipt, or what happened..."></textarea></label><button class="btn primary" type="submit">Report issue</button><small>This creates a review item connected to your vehicle and customer file.</small></form>';
  const portalDocumentForm = '<form method="POST" action="/customer/document-update" class="customer-message-form customer-document-form"><label>Send document / proof update<select name="type"><option>Insurance proof</option><option>Driver license</option><option>Registration</option><option>Background check info</option><option>Proof of income</option><option>Other document</option></select></label><label>Provider / agency<input name="provider" maxlength="120" placeholder="Insurance company, DMV, background provider..."></label><label>Policy / reference<input name="reference" maxlength="160" placeholder="Policy, notice, confirmation, or reference number"></label><label>Expiration / due date<input name="expires" type="date"></label><label>Proof link / photo note<input name="proofUrl" maxlength="500" placeholder="Paste a photo/document link or write where proof was sent"></label><label>Note / proof placeholder<textarea name="notes" maxlength="1200" placeholder="Tell us what changed. Real file upload/email attachment can connect here later."></textarea></label><button class="btn primary" type="submit">Send update</button><small>This saves to your customer file and alerts WheelsonAuto to verify it.</small></form>';
  const cardChangeForm = customerPortalActionForm('/customer/card-change', 'Change card on file', 'Opens a secure Clover card setup link. WheelsonAuto never sees the full card number.', 'customer-card-form');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My WheelsonAuto</title>' + BROWSER_ICON_LINKS + CSS_LINK + '</head><body><main class="customer-portal"><header class="customer-hero"><a class="customer-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><span>WheelsonAuto</span></a><div><div class="eyebrow">Customer portal</div><h1>Hi, ' + escapeHtml(customerName.split(/\s+/)[0] || customerName) + '</h1><p>Your vehicle, payments, service, documents, messages, and account status in one place.</p></div><a class="btn danger" href="/customer/logout">Log out</a></header><section class="customer-summary-grid"><article><span>Payment</span><strong>' + moneyText(amount) + '</strong><small>' + escapeHtml(recurring.frequency || summary.frequency || 'Schedule not set') + '</small></article><article><span>Status</span><strong>' + escapeHtml(paymentStatus) + '</strong><small>' + escapeHtml(recurring.paymentSetup || summary.paymentSetup || 'Card/account status') + '</small></article><article><span>Next charge</span><strong>' + escapeHtml(recurring.nextRun || summary.nextRun || 'Not set') + '</strong><small>' + escapeHtml(recurring.chargeTime || summary.chargeTime || 'Time not set') + '</small></article><article><span>Vehicle</span><strong>' + escapeHtml(vehicleTitle) + '</strong><small>' + escapeHtml([tag, summary.vin || vehicle.vin || 'VIN not linked'].filter(Boolean).join(' | ')) + '</small></article></section><section class="customer-grid"><article class="customer-panel"><div class="section-head"><h2>Vehicle</h2></div><div class="customer-detail"><strong>' + escapeHtml(vehicleTitle) + '</strong><span>VIN: ' + escapeHtml(summary.vin || vehicle.vin || 'Not linked') + '</span><span>Tag/plate: ' + escapeHtml(tag || 'Not linked') + '</span><span>Tracker: ' + escapeHtml(summary.tracker || vehicle.tracker || 'Not linked') + '</span><span>Status: ' + escapeHtml(vehicle.status || 'Not set') + '</span></div></article><article class="customer-panel"><div class="section-head"><h2>Autopay</h2></div><div class="customer-detail"><strong>' + moneyText(amount) + ' ' + escapeHtml(recurring.frequency || '') + '</strong><span>Status: ' + escapeHtml(paymentStatus) + '</span><span>Next: ' + escapeHtml(recurring.nextRun || 'Not set') + '</span><span>Time: ' + escapeHtml(recurring.chargeTime || 'Not set') + '</span><span>Card: ' + escapeHtml(recurring.cardLabel || recurring.cardLast4 ? [recurring.cardLabel, recurring.cardLast4 && ('ending ' + recurring.cardLast4)].filter(Boolean).join(' ') : (recurring.paymentSetup || 'Ask office')) + '</span>' + cardChangeForm + '</div></article></section><section class="customer-grid"><article class="customer-panel"><div class="section-head"><h2>Recent payments</h2></div>' + portalPaidOutsideForm + '<div class="customer-list">' + customerPortalList(state.payments, 'No payment records are linked to this account yet.', p => '<div class="customer-row"><div><strong>' + escapeHtml(p.status || 'Recorded') + '</strong><small>' + escapeHtml([p.date || p.createdAt || '', p.method || p.type || p.source || 'Payment'].filter(Boolean).join(' - ')) + '</small></div><b>' + moneyText(p.amount || 0) + '</b></div>') + '</div></article><article class="customer-panel"><div class="section-head"><h2>Documents & receipts</h2></div>' + portalDocumentForm + '<div class="customer-list">' + customerPortalList(state.documents, 'No customer-visible documents or receipts are linked to this account yet.', d => '<div class="customer-row"><div><strong>' + escapeHtml(d.title || d.type || d.kind || 'Document') + '</strong><small>' + escapeHtml([d.kind || d.type || 'Document', d.date || d.createdAt || '', d.method || d.status || '', d.vehicle || vehicleTitle].filter(Boolean).join(' - ')) + '</small>' + (d.url || d.reference ? '<p>' + escapeHtml(d.url || d.reference) + '</p>' : '') + '</div>' + (d.amount ? '<b>' + moneyText(d.amount || 0) + '</b>' : '<span>' + escapeHtml(d.status || '') + '</span>') + '</div>') + '</div></article></section><section class="customer-grid"><article class="customer-panel"><div class="section-head"><h2>Service</h2></div>' + portalServiceForm + '<div class="customer-list">' + customerPortalList(state.maintenance, 'No service reminders are linked to this account yet.', m => '<div class="customer-row"><div><strong>' + escapeHtml(m.type || m.issue || 'Service') + '</strong><small>' + escapeHtml([m.vehicle || vehicleTitle, m.due || m.nextDue || '', m.status || 'Open'].filter(Boolean).join(' - ')) + '</small></div><span>' + escapeHtml(m.status || 'Open') + '</span></div>') + '</div></article><article class="customer-panel"><div class="section-head"><h2>Claims, tolls & issues</h2></div>' + portalIssueForm + '<div class="customer-list">' + customerPortalList(state.claims, 'No open tolls, claims, or issues are linked to this account.', c => '<div class="customer-row"><div><strong>' + escapeHtml(c.type || 'Issue') + '</strong><small>' + escapeHtml([c.status || 'Open', c.vehicle || vehicleTitle, c.provider || c.agency || ''].filter(Boolean).join(' - ')) + '</small></div><b>' + moneyText(c.amount || 0) + '</b></div>') + '</div></article></section><section class="customer-grid"><article class="customer-panel"><div class="section-head"><h2>Messages</h2></div>' + portalMessageForm + '<div class="customer-list">' + customerPortalList(state.messages, 'No messages are linked to this account yet.', m => '<div class="customer-row"><div><strong>' + escapeHtml(m.direction || m.status || 'Message') + '</strong><small>' + escapeHtml([m.channel || 'Message', m.date || m.createdAt || ''].filter(Boolean).join(' - ')) + '</small><p>' + escapeHtml(m.body || m.subject || '') + '</p></div></div>') + '</div></article></section></main></body></html>';
}
async function appHtml({ publicMode = false, user = null } = {}) {
  const data = await readData();
  const clientData = publicMode ? {
    vehicles: (data.vehicles || []).filter(v => ['Ready', 'Available', 'Coming soon', 'Pending application'].includes(v.status)),
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
  } : stateForUserRead(data, user || { role: 'Owner' });
  if (!publicMode) {
    clientData.integrations = clientData.integrations || {};
    clientData.integrations.messaging = { ...(clientData.integrations.messaging || {}), ...publicMessagingStatus(data) };
  }
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
    route('GET', '/customer/login', 'Customer login page'),
    route('GET', '/customer', 'Customer self-service portal'),
    route('POST', '/customer/message', 'Customer portal inbound message'),
    route('POST', '/customer/paid-outside', 'Customer portal paid-outside-app report'),
    route('POST', '/customer/service-request', 'Customer portal maintenance/service request'),
    route('POST', '/customer/issue-report', 'Customer portal toll/claim/issue report'),
    route('POST', '/customer/document-update', 'Customer portal document and verification update'),
    route('POST', '/customer/card-change', 'Customer portal card-on-file change request'),
    route('GET', '/api/customer/portal-state', 'Customer-only account state'),
    route('POST', '/api/customer-accounts', 'Owner-managed customer logins'),
    route('POST', '/api/organizations', 'Owner-managed company/store/franchise accounts'),
    route('POST', '/api/api-providers', 'API readiness setup records'),
    route('POST', '/api/tasks', 'Dispatch task creation'),
    route('POST', '/api/card-setup-requests', 'Customer card-on-file setup links'),
    route('POST', '/api/payment-links', 'Customer payment links'),
    route('GET', '/api/messages/status', 'Messaging integration status'),
    route('POST', '/api/messages/send', 'Send or save customer SMS/email messages'),
    route('POST', '/api/messages/ai-reply', 'Star AI reply/action planner'),
    route('POST', '/api/messages/ai-action', 'Approve or send Star AI drafts'),
    route('POST', '/api/messages/settings', 'Owner toggles for messaging and Star AI'),
    route('POST', '/api/notifications/email/settings', 'Owner email notification recipients'),
    route('POST', '/api/notifications/email/test', 'Send or draft test email notification'),
    route('POST', '/api/notifications/daily-closeout', 'Send or draft daily closeout notification'),
    route('GET', '/api/reports/deep.csv', 'Role-scoped deep CSV export'),
    route('GET', '/api/system/health', 'Role-scoped Star/system health snapshot'),
    route('POST', '/api/verification/document', 'Staff document proof verification'),
    route('POST', '/api/verification/paid-outside', 'Owner paid-outside payment verification'),
    route('POST', '/api/integrations/clover/manual-charge', 'Saved-card manual charges'),
    route('POST', '/api/integrations/clover/sync-all', 'Clover full sync'),
    route('POST', '/api/woa-autopay/run', 'WheelsonAuto autopay monitor'),
    route('POST', '/api/webhooks/clover', 'Clover webhook intake'),
    route('POST', '/api/webhooks/messages', 'Inbound SMS webhook intake'),
    route('POST', '/api/webhooks/email', 'Inbound email webhook intake')
  ];
  const missing = envChecks.filter(item => item[1] === 'Missing').map(item => item[0]);
  const records = {
    vehicles: (data.vehicles || []).length,
    customers: (data.customers || []).length,
    customerAccounts: (data.customerAccounts || []).length,
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
function cloverExternalReference(payment) {
  payment = payment || {};
  return String(payment.external_reference_id || payment.externalReferenceId || payment.externalPaymentId || payment.external_reference || '').trim();
}
function cloverExternalCustomerReference(payment) {
  payment = payment || {};
  return String(payment.external_customer_reference || payment.externalCustomerReference || payment.externalCustomerId || '').trim();
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
function cloverPaymentDescriptionName(payment) {
  const description = String(payment && (payment.description || payment.note || payment.memo) || '').trim();
  const match = description.match(/WheelsonAuto\s+.*?payment\s+-\s+(.+)$/i);
  return match ? usefulPaymentName(match[1]) : '';
}
function mapCloverPayment(payment) {
  const amount = Number(payment.amount || 0) / 100;
  const created = payment.createdTime ? new Date(payment.createdTime).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US');
  const customerSource = cloverPaymentCustomerSource(payment);
  const externalCustomerReference = cloverExternalCustomerReference(payment);
  const externalReferenceId = cloverExternalReference(payment);
  const customer = cloverPersonName(customerSource) || usefulPaymentName(payment.customerName) || usefulPaymentName(externalCustomerReference) || cloverPaymentDescriptionName(payment) || cloverPaymentFallbackName(payment) || '';
  return {
    id: 'clover-payment-' + payment.id,
    cloverPaymentId: payment.id,
    cloverCustomerId: String(customerSource.id || payment.customerId || payment.cloverCustomerId || (/^[A-Z0-9]{8,}$/.test(externalCustomerReference) ? externalCustomerReference : '') || '').trim(),
    cloverOrderId: cloverPaymentOrderId(payment),
    externalReferenceId,
    externalCustomerReference,
    employee: payment.employee && payment.employee.name ? payment.employee.name : '',
    date: created,
    customer: customer || 'Unmatched Clover payment',
    method: payment.tender && payment.tender.label ? payment.tender.label : 'Clover',
    amount,
    status: payment.result === 'SUCCESS' ? 'Paid' : (payment.result || 'Recorded'),
    source: 'Clover',
    notes: String(payment.description || payment.note || '').trim(),
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
function normalizedPaymentRecordId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^clover-payment-/i, '').replace(/^clover-manual-charge-/i, '');
}
function paymentRecordIds(item) {
  item = item || {};
  return [
    item.cloverPaymentId,
    item.cloverChargeId,
    item.paymentId,
    item.externalPaymentId,
    item.externalReferenceId,
    item.external_reference_id,
    item.external_reference,
    item.paymentRequestId,
    item.chargeId,
    item.id
  ].map(normalizedPaymentRecordId).filter(Boolean);
}
function paymentRecordsMatch(a, b) {
  const aIds = paymentRecordIds(a);
  const bIds = paymentRecordIds(b);
  if (!aIds.length || !bIds.length) return false;
  return aIds.some(id => bIds.includes(id));
}
function weakPaymentCustomer(value) {
  const raw = String(value || '').trim();
  return !raw || raw === 'Unmatched Clover payment' || raw === 'Clover payment' || raw === 'Unknown customer';
}
function mergePaymentRecord(existing, incoming) {
  const weakIncomingName = weakPaymentCustomer(incoming.customer);
  const weakExistingName = weakPaymentCustomer(existing.customer);
  const merged = { ...existing, ...incoming };
  if (weakIncomingName && !weakExistingName) merged.customer = existing.customer;
  if (!weakIncomingName && weakExistingName) merged.customer = incoming.customer;
  ['phone', 'email', 'vehicle', 'vehicleId', 'vin', 'licensePlate', 'plate', 'tempTag', 'tracker', 'recurringPaymentId', 'cloverCustomerId', 'cloverSubscriptionId', 'externalReferenceId', 'externalCustomerReference'].forEach(key => {
    if (!merged[key] && existing[key]) merged[key] = existing[key];
  });
  return merged;
}
function weakClaimCustomer(value) {
  const raw = String(value || '').trim();
  return !raw || /^(unknown|unassigned|customer|unmatched clover payment|clover dispute|clover customer|n\/a|na)$/i.test(raw);
}
function claimIdentityTokens(claim = {}) {
  return [
    claim.paymentId,
    claim.cloverPaymentId,
    claim.cloverChargeId,
    claim.chargeId,
    claim.transactionId,
    claim.externalPaymentId,
    claim.externalReferenceId,
    claim.externalId,
    claim.caseId,
    claim.disputeId,
    claim.paymentRequestId
  ].map(normalizedPaymentRecordId).filter(Boolean);
}
function paymentMatchesClaim(payment = {}, claim = {}) {
  const claimTokens = claimIdentityTokens(claim);
  if (claimTokens.length && paymentRecordIds(payment).some(id => claimTokens.includes(id))) return true;
  const reference = normKey([claim.reference, claim.plate, claim.evidence, claim.notes].filter(Boolean).join(' '));
  if (!reference) return false;
  return paymentRecordIds(payment).some(id => id && reference.includes(normKey(id)));
}
function deepFindWebhookValue(value, keyPattern, depth = 0) {
  if (!value || depth > 5) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindWebhookValue(item, keyPattern, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const [key, item] of Object.entries(value)) {
    if (keyPattern.test(key) && item !== null && typeof item !== 'object') return String(item).trim();
    if (keyPattern.test(key) && item && typeof item === 'object' && item.id) return String(item.id).trim();
    const found = deepFindWebhookValue(item, keyPattern, depth + 1);
    if (found) return found;
  }
  return '';
}
function cloverWebhookDisputeClaim(event = {}) {
  const text = JSON.stringify(event || {}).slice(0, 10000);
  if (!/dispute|chargeback/i.test(text)) return null;
  const paymentId = deepFindWebhookValue(event, /^(paymentId|payment_id|cloverPaymentId|payment)$/i)
    || (/payment[s]?\/([A-Za-z0-9_-]+)/i.exec(text) || [])[1]
    || '';
  const objectId = String(event.objectId || event.id || deepFindWebhookValue(event, /^(objectId|object_id|eventId|event_id)$/i) || '').trim();
  const disputeId = String(event.disputeId || event.chargebackId || deepFindWebhookValue(event, /^(dispute|disputeId|dispute_id|chargeback|chargebackId|chargeback_id|case|caseId|case_id)$/i) || '').trim();
  const amountRaw = deepFindWebhookValue(event, /^(amount|disputedAmount|chargebackAmount|amount_disputed)$/i);
  const amountNumber = Number(amountRaw || 0);
  const amount = amountNumber > 999 ? amountNumber / 100 : amountNumber;
  const externalId = disputeId || paymentId || objectId || ('clover-dispute-' + Date.now());
  return {
    id: 'claim-clover-dispute-' + normKey(externalId || Date.now()).slice(0, 60),
    type: 'Clover dispute',
    source: 'Clover webhook',
    provider: 'Clover',
    customer: 'Unassigned',
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    status: 'Open',
    tone: 'bad',
    externalId,
    disputeId,
    paymentId,
    cloverPaymentId: paymentId,
    reference: paymentId || objectId || disputeId,
    notes: 'Created automatically from Clover dispute/chargeback webhook. Review and match before contacting the customer.',
    createdAt: new Date().toISOString()
  };
}
function findClaimPaymentRequest(data, claim = {}) {
  const requests = data.paymentRequests || [];
  const ids = [claim.paymentRequestId, claim.paymentLinkId, claim.requestId].map(String).filter(Boolean);
  if (ids.length) {
    const found = requests.find(request => ids.includes(String(request.id || '')));
    if (found) return found;
  }
  const link = String(claim.paymentLinkUrl || claim.url || '').trim();
  if (link) return requests.find(request => request.url === link || request.checkoutHref === link) || null;
  return null;
}
function claimProfileForCustomer(data, customer) {
  const key = normKey(customer);
  if (!key) return {};
  const rows = [
    ...(data.customers || []),
    ...(data.contracts || []),
    ...allRecurringRows(data)
  ];
  return rows.find(row => normKey(row.customer || row.name || row.currentCustomer) === key) || {};
}
function claimVehicleFromSource(data, row = {}, customer = '') {
  const vehicles = data.vehicles || [];
  const vehicleId = String(row.vehicleId || '').trim();
  if (vehicleId) {
    const found = vehicles.find(vehicle => String(vehicle.id || '') === vehicleId);
    if (found) return found;
  }
  const vin = normKey(row.vin);
  if (vin) {
    const found = vehicles.find(vehicle => normKey(vehicle.vin) === vin);
    if (found) return found;
  }
  const plate = normKey(row.plate || row.licensePlate || row.tag || row.tempTag || row.stock);
  if (plate) {
    const found = vehicles.find(vehicle => [vehicle.plate, vehicle.stock, vehicle.tempTag, vehicle.licensePlate].map(normKey).includes(plate));
    if (found) return found;
  }
  const vehicleName = normKey(row.vehicle || row.vehicleName || row.name);
  if (vehicleName) {
    const found = vehicles.find(vehicle => normKey(vehicleNameFromParts(vehicle)) === vehicleName || normKey(vehicle.name) === vehicleName);
    if (found) return found;
  }
  const customerKey = normKey(customer);
  if (customerKey) {
    return vehicles.find(vehicle => normKey(vehicle.currentCustomer || vehicle.customer || vehicle.assignedTo) === customerKey) || null;
  }
  return null;
}
function claimPossibleMatches(data, claim = {}) {
  const amount = Number(claim.amount || 0);
  if (!amount || amount <= 0) return [];
  const seen = new Set();
  const candidates = [];
  function add(kind, row = {}) {
    const customer = row.customer || row.name || row.currentCustomer || '';
    if (!customer) return;
    const candidateAmount = Number(row.amount || row.weeklyAmount || row.total || 0);
    if (Math.abs(candidateAmount - amount) > 0.01) return;
    const key = kind + '|' + normKey(customer) + '|' + normalizedPaymentRecordId(row.id || row.cloverPaymentId || row.paymentId || row.cloverCustomerId || '');
    if (seen.has(key)) return;
    seen.add(key);
    const profile = claimProfileForCustomer(data, customer);
    const merged = { ...profile, ...row };
    const vehicle = claimVehicleFromSource(data, merged, customer) || {};
    const vehicleLabel = merged.vehicle || merged.vehicleName || (vehicle.id ? vehicleNameFromParts(vehicle) : '');
    const plate = merged.plate || merged.licensePlate || merged.tag || merged.tempTag || vehicle.plate || vehicle.stock || vehicle.tempTag || '';
    candidates.push({
      type: kind,
      customer,
      amount: candidateAmount,
      date: row.date || row.createdAt || row.nextRun || '',
      vehicleId: merged.vehicleId || vehicle.id || '',
      vehicle: vehicleLabel,
      vin: merged.vin || vehicle.vin || '',
      plate,
      tracker: merged.tracker || vehicle.tracker || '',
      phone: merged.phone || '',
      email: merged.email || '',
      cloverCustomerId: merged.cloverCustomerId || '',
      recurringPaymentId: merged.recurringPaymentId || (kind === 'Recurring' ? merged.id : '') || '',
      reference: row.cloverPaymentId || row.paymentId || row.id || row.cloverCustomerId || '',
      matchReason: kind + ' has the same amount as this dispute. Review the customer, vehicle, VIN/tag, and date before accepting.'
    });
  }
  (data.payments || []).forEach(row => add('Payment', row));
  allRecurringRows(data).forEach(row => add('Recurring', row));
  return candidates.slice(0, 5);
}
function findClaimVehicle(data, claim = {}) {
  const vehicles = data.vehicles || [];
  const vehicleId = String(claim.vehicleId || '').trim();
  if (vehicleId) {
    const found = vehicles.find(vehicle => vehicle.id === vehicleId);
    if (found) return found;
  }
  const vin = normKey(claim.vin);
  if (vin) {
    const found = vehicles.find(vehicle => normKey(vehicle.vin) === vin);
    if (found) return found;
  }
  const plate = normKey(claim.plate || claim.reference || claim.licensePlate || claim.tag);
  if (plate) {
    const found = vehicles.find(vehicle => [vehicle.plate, vehicle.stock, vehicle.tempTag].map(normKey).includes(plate));
    if (found) return found;
  }
  const vehicleName = normKey(claim.vehicle);
  if (vehicleName) return vehicles.find(vehicle => normKey(vehicleNameFromParts(vehicle)) === vehicleName || normKey(vehicle.name) === vehicleName) || null;
  return null;
}
function applyClaimCustomerMatch(claim, source, sourceLabel) {
  if (!claim || !source) return false;
  const customer = source.customer || source.name || source.currentCustomer || '';
  if (weakClaimCustomer(claim.customer) && customer) claim.customer = customer;
  ['phone', 'email', 'vehicle', 'vehicleId', 'vin', 'licensePlate', 'plate', 'cloverCustomerId', 'recurringPaymentId'].forEach(key => {
    if (!claim[key] && source[key]) claim[key] = source[key];
  });
  if (!claim.vehicle && source.vehicleName) claim.vehicle = source.vehicleName;
  if (!claim.paymentId && (source.cloverPaymentId || source.paymentId)) claim.paymentId = source.cloverPaymentId || source.paymentId;
  if (!claim.cloverPaymentId && source.cloverPaymentId) claim.cloverPaymentId = source.cloverPaymentId;
  if (!claim.amount && source.amount) claim.amount = source.amount;
  if (customer) {
    claim.customerMatchStatus = 'Matched';
    claim.customerMatchSource = sourceLabel;
    claim.customerMatchedAt = new Date().toISOString();
    return true;
  }
  return false;
}
function resolveClaimCustomerLinks(data) {
  if (!data || !Array.isArray(data.claims)) return 0;
  const payments = data.payments || [];
  const requests = data.paymentRequests || [];
  let matched = 0;
  data.claims.forEach(claim => {
    const before = JSON.stringify([claim.customer, claim.vehicle, claim.vehicleId, claim.paymentId, claim.cloverPaymentId, claim.customerMatchSource]);
    const linkedPayment = payments.find(payment => paymentMatchesClaim(payment, claim));
    if (linkedPayment) applyClaimCustomerMatch(claim, linkedPayment, 'Payment record');
    const linkedRequest = !claim.customerMatchStatus ? findClaimPaymentRequest(data, claim) : null;
    if (linkedRequest) applyClaimCustomerMatch(claim, linkedRequest, 'Payment request');
    if (!claim.customerMatchStatus && claim.cloverCustomerId) {
      const recurring = allRecurringRows(data).find(row => String(row.cloverCustomerId || '') === String(claim.cloverCustomerId));
      if (recurring) applyClaimCustomerMatch(claim, recurring, 'Recurring customer');
    }
    if (!claim.customerMatchStatus) {
      const vehicle = findClaimVehicle(data, claim);
      if (vehicle) applyClaimCustomerMatch(claim, { ...vehicle, customer: vehicle.currentCustomer, vehicle: vehicleNameFromParts(vehicle), vehicleId: vehicle.id, licensePlate: vehicle.plate || vehicle.stock, plate: vehicle.plate || vehicle.stock }, 'Fleet vehicle');
    }
    if (!claim.customerMatchStatus && !weakClaimCustomer(claim.customer)) {
      claim.customerMatchStatus = 'Matched';
      claim.customerMatchSource = claim.customerMatchSource || 'Saved claim customer';
    }
    if (!claim.customerMatchStatus && /dispute|clover|chargeback/i.test(String([claim.type, claim.source, claim.provider].filter(Boolean).join(' ')))) {
      const candidates = claimPossibleMatches(data, claim);
      if (candidates.length) claim.matchCandidates = candidates;
      claim.customerMatchStatus = 'Needs payment/customer match';
    }
    const after = JSON.stringify([claim.customer, claim.vehicle, claim.vehicleId, claim.paymentId, claim.cloverPaymentId, claim.customerMatchSource]);
    if (before !== after) matched += 1;
  });
  return matched;
}
async function recordCloverWebhookEvent(event = {}) {
  const data = await readData();
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  data.integrations.clover.webhookEvents = data.integrations.clover.webhookEvents || [];
  data.integrations.clover.webhookEvents.unshift({ receivedAt: new Date().toISOString(), event });
  const previous = JSON.parse(JSON.stringify(data));
  const disputeClaim = cloverWebhookDisputeClaim(event);
  let createdClaimId = '';
  if (disputeClaim) {
    data.claims = Array.isArray(data.claims) ? data.claims : [];
    const disputeTokens = claimIdentityTokens(disputeClaim);
    const duplicate = data.claims.find(claim => claim.id === disputeClaim.id || claimIdentityTokens(claim).some(id => disputeTokens.includes(id)));
    if (!duplicate) {
      data.claims.unshift(disputeClaim);
      createdClaimId = disputeClaim.id;
    }
    resolveClaimCustomerLinks(data);
    await queueStateChangeNotifications(previous, data, { name: 'Clover webhook', role: 'System' });
  }
  await writeData(data);
  const webhookSyncTimer = setTimeout(() => runAutoSync({ source: 'clover webhook', force: true }).catch(err => console.error('Webhook auto sync failed:', err && err.message || err)), WEBHOOK_AUTO_SYNC_DELAY_MS);
  if (webhookSyncTimer.unref) webhookSyncTimer.unref();
  return { ok: true, disputeClaimId: createdClaimId };
}
function upsertById(list, incoming) {
  const next = Array.isArray(list) ? list.slice() : [];
  incoming.forEach(item => {
    const index = next.findIndex(existing => existing.id === item.id || paymentRecordsMatch(existing, item));
    if (index >= 0) {
      const existing = next[index];
      next[index] = mergePaymentRecord(existing, item);
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
async function protectConcurrentLocalWrites(data, options = {}) {
  await writeDataQueue.catch(() => {});
  const latest = await readData();
  const preferIncoming = !!options.preferIncoming;
  ['cardSetupRequests', 'paymentRequests', 'recurringPayments', 'vehicles', 'contracts', 'maintenance', 'claims', 'messages', 'documents', 'applications', 'tasks', 'apiProviders', 'staffAccounts', 'customerAccounts', 'organizations'].forEach(key => {
    data[key] = preferIncoming ? mergeById(data[key], latest[key]) : mergeById(latest[key], data[key]);
  });
  data.customers = preferIncoming ? upsertById(data.customers, latest.customers) : upsertById(latest.customers, data.customers);
  data.payments = preferIncoming ? upsertById(data.payments, latest.payments) : upsertById(latest.payments, data.payments);
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
  result.profileEnrichment = enrichLinkedProfiles(data);
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
    organizationId: String(payload.organizationId || payload.orgId || payload.companyId || MAIN_ORG_ID).trim(),
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
    chargeTime: String(payload.chargeTime || payload.paymentTime || '18:00').trim(),
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
function assignAutopayVehicle(data, autopay) {
  if (!autopay || !autopay.customer || (!autopay.vehicleId && !autopay.vehicle)) return;
  data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  data.contracts = Array.isArray(data.contracts) ? data.contracts : [];
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  const customerKey = normKey(autopay.customer);
  const vehicle = data.vehicles.find(row => (autopay.vehicleId && row.id === autopay.vehicleId) || (autopay.vehicle && normKey(vehicleNameFromParts(row)) === normKey(autopay.vehicle)));
  if (!vehicle) return;
  const previousCustomer = String(vehicle.currentCustomer || '').trim();
  const vehicleName = vehicleNameFromParts(vehicle);
  const tag = vehicle.plate || vehicle.stock || autopay.licensePlate || autopay.plate || '';
  const previousKey = normKey(previousCustomer);
  if (previousCustomer && previousKey !== customerKey) {
    const releaseNote = 'Vehicle reassigned to ' + autopay.customer + ' through WheelsonAuto autopay.';
    data.customers.forEach(row => {
      if (normKey(row.name || row.customer) !== previousKey) return;
      if (row.vehicleId && row.vehicleId !== vehicle.id && normKey(row.vehicle) !== normKey(vehicleName)) return;
      row.vehicleId = '';
      row.vehicle = '';
      row.status = 'Returned';
      row.stage = 'History';
      row.returnedAt = new Date().toISOString();
      row.returnedVehicle = vehicleName;
      row.returnedVin = vehicle.vin || '';
      row.returnedPlate = tag;
      row.notes = [row.notes, releaseNote].filter(Boolean).join('\n');
    });
    data.contracts.forEach(row => {
      if (normKey(row.customer || row.name) !== previousKey) return;
      if (row.vehicleId && row.vehicleId !== vehicle.id && normKey(row.vehicle) !== normKey(vehicleName)) return;
      row.status = 'Removed';
      row.endStatus = row.endStatus || 'Ended';
      row.returnedAt = new Date().toISOString();
      row.returnedVehicleId = vehicle.id || '';
      row.returnedVehicle = vehicleName;
      row.returnedVin = vehicle.vin || '';
      row.returnedPlate = tag;
      row.notes = [row.notes, releaseNote].filter(Boolean).join('\n');
    });
    data.recurringPayments.forEach(row => {
      if (normKey(row.customer) !== previousKey) return;
      if (row.vehicleId && row.vehicleId !== vehicle.id && normKey(row.vehicle) !== normKey(vehicleName)) return;
      row.vehicleId = '';
      row.vehicle = '';
      row.vin = '';
      row.licensePlate = '';
      row.plate = '';
      row.tempTag = '';
      row.tracker = '';
      row.status = 'Removed';
      row.tone = 'bad';
      row.nextRun = 'Returned';
      row.autoChargeEnabled = false;
      row.autopayManagedBy = 'Stopped - vehicle reassigned';
      row.removedAt = new Date().toISOString();
      row.notes = [row.notes, releaseNote].filter(Boolean).join('\n');
    });
  }
  vehicle.currentCustomer = autopay.customer;
  vehicle.status = String(autopay.status || '').toLowerCase() === 'active' ? 'Rented' : 'Pending application';
  vehicle.rate = autopay.amount || vehicle.rate || vehicle.price || 0;
  vehicle.price = autopay.amount || vehicle.price || vehicle.rate || 0;
  vehicle.manuallyEditedAt = new Date().toISOString();
  autopay.vehicleId = vehicle.id || autopay.vehicleId;
  autopay.vehicle = vehicleName;
  autopay.vin = vehicle.vin || autopay.vin || '';
  autopay.licensePlate = tag;
  autopay.plate = tag;
  autopay.tempTag = vehicle.tempTag || autopay.tempTag || '';
  autopay.tracker = vehicle.tracker || autopay.tracker || '';
  (data.maintenance || []).forEach(job => {
    const status = String(job.status || '').toLowerCase();
    if (status.includes('complete') || status.includes('fixed') || status.includes('closed')) return;
    const jobPlate = String(job.plate || job.licensePlate || '').trim();
    const matchesVehicle = (job.vehicleId && job.vehicleId === vehicle.id) ||
      (job.vehicle && normKey(job.vehicle) === normKey(vehicleName)) ||
      (job.vin && vehicle.vin && normKey(job.vin) === normKey(vehicle.vin)) ||
      (jobPlate && tag && normKey(jobPlate) === normKey(tag));
    if (!matchesVehicle) return;
    const oldJobCustomer = String(job.customer || '').trim();
    job.customer = autopay.customer;
    job.vehicleId = vehicle.id || job.vehicleId || '';
    job.vehicle = vehicleName;
    job.vin = vehicle.vin || job.vin || '';
    job.licensePlate = tag || job.licensePlate || '';
    job.plate = tag || job.plate || '';
    job.tempTag = vehicle.tempTag || job.tempTag || '';
    job.tracker = vehicle.tracker || job.tracker || '';
    job.customerSyncedAt = new Date().toISOString();
    if (oldJobCustomer && normKey(oldJobCustomer) !== customerKey) {
      job.previousCustomer = oldJobCustomer;
      job.notes = [job.notes, 'Open service customer updated from ' + oldJobCustomer + ' to ' + autopay.customer + ' after vehicle reassignment.'].filter(Boolean).join('\n');
    }
  });
  const customer = data.customers.find(row => normKey(row.name) === customerKey);
  if (customer) {
    customer.vehicle = vehicleName;
    customer.vehicleId = autopay.vehicleId;
    customer.weeklyAmount = autopay.amount || customer.weeklyAmount || 0;
    customer.licensePlate = tag;
    customer.plate = tag;
    customer.vin = autopay.vin;
    customer.tempTag = autopay.tempTag;
    customer.tracker = autopay.tracker;
    customer.status = String(autopay.status || '').toLowerCase() === 'active' ? 'Active' : (customer.status || 'Pending pickup');
    customer.stage = String(autopay.status || '').toLowerCase() === 'active' ? 'Active contract' : (customer.stage || 'Pending pickup');
  }
  const contract = data.contracts.find(row => normKey(row.customer) === customerKey);
  if (contract) {
    contract.vehicle = vehicleName;
    contract.vehicleId = autopay.vehicleId;
    contract.vin = autopay.vin;
    contract.licensePlate = tag;
    contract.plate = tag;
    contract.tempTag = autopay.tempTag;
    contract.tracker = autopay.tracker;
    contract.weekly = autopay.amount || contract.weekly || 0;
    contract.status = String(autopay.status || '').toLowerCase() === 'active' ? 'Active' : (contract.status || 'Pending pickup');
    contract.updatedAt = new Date().toISOString();
  }
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
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Payment</title>' + BROWSER_ICON_LINKS + CSS_LINK + '</head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure Clover payment</div></div></a></div><h1>Complete your WheelsonAuto payment</h1><p>This payment opens on Clover secure checkout. WheelsonAuto never stores your card or bank details.</p></div><main class="public-main"><section class="card section"><div class="grid two"><div class="item"><strong>Customer</strong><div>' + safeName + '</div><div class="muted">' + vehicle + '</div></div><div class="item"><strong>Amount due</strong><div class="money">' + amount + '</div><div class="muted">' + escapeHtml(request.frequency || 'Recurring payment') + '</div></div></div>' + (message ? '<div class="notice" style="margin-top:12px">' + escapeHtml(message) + '</div>' : '') + '<form method="POST" action="/api/public/payment-links/' + encodeURIComponent(request.id) + '/checkout" style="margin-top:14px"><button class="btn primary" type="submit">Pay securely with Clover</button><a class="btn" href="https://www.wheelsonauto.com/">Back to WheelsonAuto</a></form></section></main></div></body></html>';
}
function paymentResultHtml(title, message) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Payment</title>' + BROWSER_ICON_LINKS + CSS_LINK + '</head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure Clover payment</div></div></a></div><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p></div><main class="public-main"><section class="card section"><a class="btn primary" href="https://www.wheelsonauto.com/">Back to WheelsonAuto</a></section></main></div></body></html>';
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
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  const customerKey = normKey(autopay.customer);
  const reactivateId = String(payload.recurringPaymentId || payload.id || '').trim();
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  const cloverMembers = data.integrations.clover.recurringPlanMembers = Array.isArray(data.integrations.clover.recurringPlanMembers) ? data.integrations.clover.recurringPlanMembers : [];
  const existingAutopayById = payload.reactivateExisting && reactivateId ? data.recurringPayments.find(row => row.id === reactivateId || row.cardSetupRequestId === reactivateId || row.cloverSubscriptionId === reactivateId) : null;
  const existingAutopayByName = payload.reactivateExisting && customerKey ? data.recurringPayments.find(row => normKey(row.customer) === customerKey) : null;
  const existingMemberById = payload.reactivateExisting && reactivateId ? cloverMembers.find(row => row.id === reactivateId || row.cardSetupRequestId === reactivateId || row.cloverSubscriptionId === reactivateId) : null;
  const existingMemberByName = payload.reactivateExisting && customerKey ? cloverMembers.find(row => normKey(row.customer) === customerKey) : null;
  const existingAutopay = existingAutopayById || existingAutopayByName;
  const existingMember = existingMemberById || existingMemberByName;
  const cardTarget = existingAutopayById || existingMemberById || existingAutopayByName || existingMemberByName;
  const cardOnlyUpdate = !!(payload.cardOnlyUpdate && cardTarget);
  if (cardTarget) autopay.id = cardTarget.id || (existingAutopay && existingAutopay.id) || autopay.id;
  const request = {
    id: 'setup-' + crypto.randomBytes(12).toString('hex'),
    organizationId: autopay.organizationId || MAIN_ORG_ID,
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
    chargeTime: autopay.chargeTime,
    cloverPlanId: String(payload.cloverPlanId || payload.planId || '').trim(),
    cloverSubscriptionId: String(payload.cloverSubscriptionId || '').trim(),
    status: 'Open',
    source: 'WheelsonAuto card setup',
    createdAt: new Date().toISOString(),
    url: ''
  };
  request.url = PUBLIC_BASE_URL + '/setup-card/' + request.id;
  request.cardOnlyUpdate = cardOnlyUpdate;
  autopay.cardSetupRequestId = request.id;
  autopay.cardSetupUrl = request.url;
  autopay.cloverPlanId = request.cloverPlanId;
  data.cardSetupRequests = Array.isArray(data.cardSetupRequests) ? data.cardSetupRequests : [];
  if (!cardOnlyUpdate) assignAutopayVehicle(data, autopay);
  if (cardOnlyUpdate) {
    Object.assign(cardTarget, {
      cardSetupRequestId: request.id,
      cardSetupUrl: request.url,
      cardChangePendingAt: new Date().toISOString(),
      paymentSetup: 'Card change link sent',
      lastCardSetupReason: String(payload.reason || 'Change card on file').trim(),
      updatedAt: new Date().toISOString()
    });
  } else if (existingAutopay) {
    Object.assign(existingAutopay, autopay, {
      id: existingAutopay.id,
      createdAt: existingAutopay.createdAt || autopay.createdAt,
      reactivatedAt: new Date().toISOString()
    });
  } else data.recurringPayments.unshift(autopay);
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
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelsonAuto Card Setup</title>' + BROWSER_ICON_LINKS + CSS_LINK + '<script src="' + sdkUrl + '"></script></head><body><div class="public-shell"><div class="public-hero"><div class="public-head"><a class="public-brand brand-link" href="https://www.wheelsonauto.com/"><img class="brand-logo" src="https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=180" alt="WheelsonAuto logo"><div><strong>WheelsonAuto</strong><div class="small">Secure card setup</div></div></a></div><h1>Set up automatic payments</h1><p>Save your card securely with Clover so WheelsonAuto can run authorized recurring and manual catch-up payments.</p></div><main class="public-main"><section class="card section"><div class="grid two"><div class="item"><strong>Customer</strong><div>' + escapeHtml(request.customer || 'Customer') + '</div><div class="muted">' + escapeHtml(request.vehicle || 'WheelsonAuto account') + '</div></div><div class="item"><strong>Recurring amount</strong><div class="money">' + amount + '</div><div class="muted">' + escapeHtml(request.frequency || 'Weekly') + '</div></div></div>' + (message ? '<div class="notice" style="margin-top:12px">' + escapeHtml(message) + '</div>' : '') + (!setupReady ? '<div class="notice" style="margin-top:12px">Card setup is not ready yet. WheelsonAuto needs the Clover Ecommerce public key and private key in Render.</div>' : '') + '<form id="cardSetupForm" class="form" style="margin-top:14px"><div class="field span2"><label>Name on card</label><input id="cardName" autocomplete="cc-name" value="' + escapeHtml(request.customer || '') + '"' + disabled + '></div><div class="field span2"><label>Card number</label><div id="cardNumber" class="clover-field"></div><div id="cardNumberErrors" class="small err"></div></div><div class="field"><label>Expiration</label><div id="cardDate" class="clover-field"></div><div id="cardDateErrors" class="small err"></div></div><div class="field"><label>CVV</label><div id="cardCvv" class="clover-field"></div><div id="cardCvvErrors" class="small err"></div></div><div class="field"><label>ZIP</label><div id="cardZip" class="clover-field"></div><div id="cardZipErrors" class="small err"></div></div><label class="check span2"><input id="consent" type="checkbox"' + disabled + '> I authorize WheelsonAuto to save this card with Clover and charge authorized recurring payments, retries, and manual catch-up payments for my account.</label><div class="notice span2">Your card is entered in Clover secure fields for tokenization. WheelsonAuto stores only the Clover saved-card/customer reference, not the card number or CVV.</div><div class="span2 actions"><button class="btn primary" type="submit"' + disabled + '>Save card with Clover</button><a class="btn" href="https://www.wheelsonauto.com/">Cancel</a></div></form><div id="setupMessage" class="notice" style="display:none;margin-top:12px"></div></section></main></div><script>window.__CARD_SETUP__=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';</script><script src="/card-setup.js?v=clover-iframe-1"></script></body></html>';
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
  request.cloverSubscriptionId = subscription && subscription.id || request.cloverSubscriptionId || '';
  data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
  data.integrations = data.integrations || {};
  data.integrations.clover = data.integrations.clover || {};
  const members = data.integrations.clover.recurringPlanMembers = Array.isArray(data.integrations.clover.recurringPlanMembers) ? data.integrations.clover.recurringPlanMembers : [];
  const allRows = [...data.recurringPayments, ...members];
  const exactRecurringRows = allRows.filter(row => row && (row.id === request.recurringPaymentId || row.cardSetupRequestId === request.id || (request.cloverSubscriptionId && row.cloverSubscriptionId === request.cloverSubscriptionId)));
  const recurringRows = exactRecurringRows.length ? exactRecurringRows : allRows.filter(row => row && request.customer && normKey(row.customer) === normKey(request.customer));
  const seenRecurring = new Set();
  const recurringPatch = {
    status: 'Active',
    tone: 'good',
    paymentSetup: subscription ? 'Active in Clover' : 'Card saved for WheelsonAuto charges',
    cloverCustomerId: customer.id || '',
    cloverPaymentSource: cardSource || token,
    cloverCardId: request.cloverCardId,
    cardLabel: payload.brand || savedCard.brand || savedCard.cardBrand || '',
    cardLast4: payload.last4 || savedCard.last4 || '',
    cardSavedAt: new Date().toISOString(),
    cardChangeCompletedAt: request.cardOnlyUpdate ? new Date().toISOString() : '',
    cardChangePendingAt: '',
    autoChargeEnabled: true,
    autopayManagedBy: 'WheelsonAuto'
  };
  if (request.cloverSubscriptionId) recurringPatch.cloverSubscriptionId = request.cloverSubscriptionId;
  recurringRows.forEach(row => {
    const key = row.id || row.cloverSubscriptionId || row.customer;
    if (!key || seenRecurring.has(key)) return;
    seenRecurring.add(key);
    Object.assign(row, recurringPatch, {
      notes: [row.notes, request.cardOnlyUpdate ? 'Customer updated card-on-file through WheelsonAuto setup link.' : 'Customer authorized card-on-file through WheelsonAuto setup link.'].filter(Boolean).join('\n')
    });
  });
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  const existing = data.customers.find(c => String(c.name || '').toLowerCase() === String(request.customer || '').toLowerCase());
  const customerPatch = { cloverCustomerId: customer.id || '', cardLast4: payload.last4 || savedCard.last4 || '', cardLabel: payload.brand || savedCard.brand || savedCard.cardBrand || '', source: 'WheelsonAuto card setup' };
  if (existing) Object.assign(existing, customerPatch);
  await queueOwnerEmailNotification(data, 'card_setup_completed', {
    customer: request.customer || 'Customer',
    subject: 'Card on file saved - ' + (request.customer || 'Customer'),
    body: [
      'A customer saved or updated a card on file through WheelsonAuto.',
      'Customer: ' + (request.customer || 'Customer'),
      'Vehicle: ' + (request.vehicle || request.vin || 'Not linked'),
      'Amount: ' + moneyText(request.amount || 0),
      'Frequency: ' + (request.frequency || 'Not set'),
      'Next run: ' + (request.firstRun || 'Not set'),
      'Card: ' + ([customerPatch.cardLabel, customerPatch.cardLast4 && ('ending ' + customerPatch.cardLast4)].filter(Boolean).join(' ') || 'Saved in Clover'),
      'Mode: ' + (request.cardOnlyUpdate ? 'Card change' : 'New setup')
    ].join('\n')
  });
  await writeData(data);
  return { customer, subscription, recurring: recurringRows[0] || null };
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
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: WOA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const year = (parts.find(part => part.type === 'year') || {}).value || date.getFullYear();
  const month = (parts.find(part => part.type === 'month') || {}).value || String(date.getMonth() + 1).padStart(2, '0');
  const day = (parts.find(part => part.type === 'day') || {}).value || String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function recurringDateKey(row) {
  const raw = String(row && row.nextRun || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'today' || raw.includes('today')) return localDateKey();
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}
function chargeTimeMinutes(row) {
  const raw = String(row && (row.chargeTime || row.paymentTime || row.autopayTime) || '18:00').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 18 * 60;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}
function businessMinutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: WOA_TIME_ZONE, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(date);
  const hour = Number((parts.find(part => part.type === 'hour') || {}).value || 0);
  const minute = Number((parts.find(part => part.type === 'minute') || {}).value || 0);
  return hour * 60 + minute;
}
function retryDelayPassed(row, date = new Date()) {
  const attempts = Number(row && (row.retryCount || row.failedAttempts) || 0);
  if (attempts < 1) return true;
  const last = new Date(String(row.lastAutoChargeAttemptAt || row.lastFailedAt || ''));
  if (Number.isNaN(last.getTime())) return true;
  return date.getTime() - last.getTime() >= 60 * 60 * 1000;
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
  if (businessMinutesNow() < chargeTimeMinutes(row)) return false;
  if (!retryDelayPassed(row)) return false;
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
function isPaymentNotFoundError(err) {
  const message = String(err && err.message || err || '').toLowerCase();
  return /payment not found|resource_missing|not found|valid source or token|source or token|saved-card token|saved card token/.test(message);
}
function recurringPaymentIdentity(data, row = {}, payload = {}) {
  const customer = row.customer || payload.customer || '';
  const vehicle = reportVehicleFor(data, customer, row.vehicleId || payload.vehicleId || '');
  const vehicleName = vehicle.id ? vehicleNameFromParts(vehicle) : (row.vehicle || payload.vehicle || '');
  const tag = vehicle.plate || vehicle.stock || row.licensePlate || row.plate || payload.licensePlate || payload.plate || '';
  return {
    vehicleId: vehicle.id || row.vehicleId || payload.vehicleId || '',
    vehicle: vehicleName,
    vin: vehicle.vin || row.vin || payload.vin || '',
    licensePlate: tag,
    plate: tag,
    tempTag: vehicle.tempTag || row.tempTag || payload.tempTag || '',
    tracker: vehicle.tracker || row.tracker || payload.tracker || ''
  };
}
function savePaymentNotFoundResult(data, row, payload = {}, err, options = {}) {
  const stamp = new Date().toISOString();
  const message = String(err && err.message || err || 'Payment was not found in Clover.');
  const amount = Number(payload.amount || row.amount || 0);
  const status = 'Payment not found - check Clover';
  const identity = recurringPaymentIdentity(data, row, payload);
  const payment = {
    id: 'payment-not-found-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
    date: new Date().toLocaleString('en-US'),
    customer: row.customer || payload.customer || 'Unknown customer',
    method: options.method || 'Clover saved card',
    amount,
    status,
    tone: 'warn',
    source: options.source || 'WheelsonAuto payment check',
    notes: [String(payload.note || '').trim(), message].filter(Boolean).join(' | '),
    recurringPaymentId: row.id || '',
    cloverCustomerId: row.cloverCustomerId || '',
    cloverSubscriptionId: row.cloverSubscriptionId || '',
    ...identity
  };
  data.payments = Array.isArray(data.payments) ? data.payments : [];
  data.payments.unshift(payment);
  const attempts = Array.isArray(row.paymentAttempts) ? row.paymentAttempts.slice() : [];
  attempts.unshift({
    id: 'attempt-not-found-' + Date.now(),
    date: payment.date,
    customer: payment.customer,
    amount,
    result: status,
    method: payment.method,
    notes: payment.notes,
    vehicle: payment.vehicle,
    vehicleId: payment.vehicleId,
    vin: payment.vin,
    plate: payment.plate,
    tracker: payment.tracker
  });
  updateRecurringChargeState(data, row.id || row.cloverSubscriptionId, {
    status,
    tone: 'warn',
    lastAutoChargeResult: status,
    lastAutoChargeError: message,
    lastAutoChargeAttemptDate: options.dateKey || localDateKey(),
    lastAutoChargeAttemptAt: stamp,
    lastPaymentNotFoundAt: stamp,
    lastPaymentResult: status,
    lastPaymentNote: payment.notes,
    paymentAttempts: attempts
  });
  return payment;
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
    description: ('WheelsonAuto ' + (recurring.frequency || 'recurring') + ' payment - ' + (recurring.customer || 'Customer')).slice(0, 255),
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
  const identity = recurringPaymentIdentity(data, recurring, payload);
  const payment = {
    id: 'clover-manual-charge-' + (charge.id || Date.now()),
    cloverPaymentId: charge.id || charge.charge || '',
    cloverChargeId: charge.id || charge.charge || '',
    externalReferenceId: ref,
    externalCustomerReference: String(recurring.cloverCustomerId || recurring.customer || '').slice(0, 64),
    date: new Date().toLocaleString('en-US'),
    customer: recurring.customer,
    phone: recurring.phone || '',
    email: recurring.email || '',
    vehicle: identity.vehicle || recurring.vehicle || '',
    vehicleId: identity.vehicleId || recurring.vehicleId || '',
    vin: identity.vin || recurring.vin || '',
    licensePlate: identity.licensePlate || recurring.licensePlate || recurring.plate || '',
    plate: identity.plate || recurring.plate || recurring.licensePlate || '',
    tempTag: identity.tempTag || recurring.tempTag || '',
    tracker: identity.tracker || recurring.tracker || '',
    method: 'Clover saved card',
    amount,
    status: paid ? 'Paid' : (charge.status || charge.result || 'Submitted'),
    tone: paid ? 'good' : 'warn',
    source: 'Clover saved-card charge',
    notes: String(payload.note || '').trim(),
    recurringPaymentId: recurring.id || '',
    cloverCustomerId: recurring.cloverCustomerId || '',
    cloverSubscriptionId: recurring.cloverSubscriptionId || ''
  };
  data.payments = Array.isArray(data.payments) ? data.payments : [];
  data.payments.unshift(payment);
  const attempts = Array.isArray(recurring.paymentAttempts) ? recurring.paymentAttempts.slice() : [];
  attempts.unshift({
    id: 'attempt-clover-charge-' + (charge.id || Date.now()),
    date: payment.date,
    customer: payment.customer,
    amount,
    result: payment.status,
    method: payment.method,
    notes: payment.notes,
    vehicle: payment.vehicle,
    vehicleId: payment.vehicleId,
    vin: payment.vin,
    plate: payment.plate,
    tracker: payment.tracker,
    cloverPaymentId: payment.cloverPaymentId,
    recurringPaymentId: payment.recurringPaymentId
  });
  updateRecurringChargeState(data, recurring.id, {
    status: paid ? 'Active' : 'Payment submitted',
    tone: paid ? 'good' : 'warn',
    retryCount: paid ? 0 : (recurring.retryCount || recurring.failedAttempts || 0),
    failedAttempts: paid ? 0 : (recurring.failedAttempts || recurring.retryCount || 0),
    nextRun: String(payload.nextRun || recurring.nextRun || '').trim(),
    lastPaymentAt: new Date().toISOString(),
    lastCloverChargeId: payment.cloverChargeId,
    lastManualChargeAt: new Date().toISOString(),
    lastPaymentResult: payment.status,
    lastPaymentNote: payment.notes,
    paymentAttempts: attempts
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
        if (isPaymentNotFoundError(err)) {
          const payment = savePaymentNotFoundResult(data, row, {
            amount: row.amount,
            note: 'WheelsonAuto autopay could not confirm payment for due date ' + dateKey
          }, err, { dateKey, source: 'WheelsonAuto autopay payment not found' });
          row.status = payment.status;
          row.tone = 'warn';
          row.lastAutoChargeResult = payment.status;
          row.lastAutoChargeError = String(err && err.message || err);
          row.lastAutoChargeAttemptDate = dateKey;
          row.lastAutoChargeAttemptAt = new Date().toISOString();
          queueCustomerMessage(data, row, 'Payment not found', 'Ready to send', 'Hi ' + (row.customer || 'there') + ', this is WheelsonAuto. We could not confirm today\'s payment of $' + Number(row.amount || 0).toLocaleString() + '. Please contact us so we can verify your payment source.', 'warn');
          await queueOwnerEmailNotification(data, 'payment_not_found', {
            customer: row.customer || 'Unknown customer',
            subject: 'Payment not found - ' + (row.customer || 'Unknown customer'),
            body: [
              'WheelsonAuto could not confirm an autopay payment.',
              'Customer: ' + (row.customer || 'Unknown customer'),
              'Amount: $' + Number(row.amount || 0).toLocaleString(),
              'Due date: ' + dateKey,
              'Vehicle: ' + (row.vehicle || row.vin || 'Not linked'),
              'Status: ' + payment.status,
              'Error: ' + String(err && err.message || err)
            ].join('\n')
          });
          result.notFound = (result.notFound || 0) + 1;
          result.errors.push((row.customer || row.id) + ': ' + payment.status);
          continue;
        }
        const attempts = Math.min(2, Number(row.retryCount || row.failedAttempts || 0) + 1);
        row.retryCount = attempts;
        row.failedAttempts = attempts;
        row.status = attempts >= 2 ? '2x failed - contact customer' : '1x failed - retrying';
        row.tone = attempts >= 2 ? 'bad' : 'warn';
        row.lastAutoChargeResult = row.status;
        row.lastAutoChargeError = String(err && err.message || err);
        row.lastAutoChargeAttemptDate = dateKey;
        row.lastAutoChargeAttemptAt = new Date().toISOString();
        queueCustomerMessage(data, row, attempts >= 2 ? '2x failed payment' : '1x failed payment', 'Ready to send', 'Hi ' + (row.customer || 'there') + ', this is WheelsonAuto. Your payment of $' + Number(row.amount || 0).toLocaleString() + ' did not go through' + (attempts >= 2 ? ' after two attempts. Please contact us today.' : '. We will retry once, but please contact us if you need help.'), attempts >= 2 ? 'bad' : 'warn');
        await queueOwnerEmailNotification(data, 'payment_failed', {
          customer: row.customer || 'Unknown customer',
          subject: (attempts >= 2 ? '2x failed autopay - ' : '1x failed autopay - ') + (row.customer || 'Unknown customer'),
          body: [
            'WheelsonAuto autopay failed.',
            'Customer: ' + (row.customer || 'Unknown customer'),
            'Amount: $' + Number(row.amount || 0).toLocaleString(),
            'Due date: ' + dateKey,
            'Attempt: ' + attempts + ' of 2',
            'Vehicle: ' + (row.vehicle || row.vin || 'Not linked'),
            'Status: ' + row.status,
            'Error: ' + row.lastAutoChargeError
          ].join('\n')
        });
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
    if (url.pathname === '/apply' && req.method === 'GET') return send(res, 200, await appHtml({ publicMode: true }), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
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
      if (selectedVehicle && ['Ready', 'Available', 'Coming soon', 'Pending application'].includes(selectedVehicle.status)) {
        selectedVehicle.status = 'Pending application';
        selectedVehicle.pendingApplicant = app.name || '';
        selectedVehicle.pendingApplicationId = app.id;
        selectedVehicle.lastLeadAt = app.submittedAt;
        selectedVehicle.notes = [selectedVehicle.notes, 'Website application submitted by ' + (app.name || 'applicant') + ' on ' + app.submittedAt].filter(Boolean).join('\n');
      }
      if (!data.websiteLeads.some(existing => existing.applicationId === app.id)) data.websiteLeads.unshift({ id: 'lead-' + Date.now(), applicationId: app.id, source: 'wheelsonauto.com/apply', name: app.name, phone: app.phone, email: app.email, vehicle: app.vehicle, vehicleId: app.vehicleId, created: 'Just now', status: 'Submitted' });
      await queueOwnerEmailNotification(data, 'application_submitted', {
        customer: app.name || 'New applicant',
        subject: 'New WheelsonAuto application - ' + (app.name || 'Applicant'),
        body: [
          'A new application was submitted on WheelsonAuto.',
          'Applicant: ' + (app.name || 'Not provided'),
          'Phone: ' + (app.phone || 'Not provided'),
          'Email: ' + (app.email || 'Not provided'),
          'Vehicle: ' + (app.vehicle || (selectedVehicle && vehicleNameFromParts(selectedVehicle)) || 'Not selected'),
          'Score: ' + (app.score || 'Not scored'),
          'Income: $' + Number(app.income || 0).toLocaleString(),
          'Down payment: $' + Number(app.down || 0).toLocaleString()
        ].join('\n')
      });
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
    if (url.pathname === '/api/webhooks/messages' && req.method === 'POST') {
      if (MESSAGING_WEBHOOK_SECRET && url.searchParams.get('secret') !== MESSAGING_WEBHOOK_SECRET && req.headers['x-woa-webhook-secret'] !== MESSAGING_WEBHOOK_SECRET) {
        return json(res, 401, { ok: false, error: 'Unauthorized webhook.' });
      }
      const rawBody = await readBody(req);
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      const payload = contentType.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(rawBody)) : JSON.parse(rawBody || '{}');
      const inbound = parseIncomingMessage(url.searchParams.get('provider'), req.headers, payload);
      const data = await readData();
      const contact = findMessageContact(data, { phone: inbound.from });
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      const exists = inbound.externalId && data.messages.some(item => item.externalId === inbound.externalId);
      let inboundRecord = null;
      let aiResult = null;
      if (!exists) {
        inboundRecord = {
          id: 'msg-in-' + Date.now(),
          externalId: inbound.externalId,
          date: new Date().toLocaleString('en-US'),
          createdAt: new Date().toISOString(),
          customer: contact.name || inbound.from || 'Unknown texter',
          phone: inbound.from,
          to: inbound.to,
          direction: 'Inbound',
          channel: 'SMS',
          template: 'Customer reply',
          subject: 'Incoming text',
          status: 'Received',
          tone: 'blue',
          body: inbound.body,
          provider: inbound.provider,
          source: 'SMS webhook',
          contactSource: contact.source || ''
        };
        data.messages.unshift(inboundRecord);
        const settings = messageSettings(data);
        if (settings.aiEnabled && settings.aiDrafts && inbound.body) {
          aiResult = await createAiMessageDraft(data, {
            messageId: inboundRecord.id,
            externalId: inbound.externalId || inboundRecord.id,
            customer: inboundRecord.customer,
            phone: inbound.from,
            body: inbound.body
          }, { sourceMessageId: inbound.externalId || inboundRecord.id });
          const plan = aiResult.plan || {};
          if (settings.aiAutoSend && plan.canAutoSend && !plan.approvalRequired && !plan.needsHuman && aiResult.draft && aiResult.draft.phone) {
            try {
              const approved = await approveAiMessage(data, { draftId: aiResult.draft.id });
              aiResult.sent = approved.sent;
            } catch (err) {
              aiResult.draft.status = 'Auto-send failed';
              aiResult.draft.tone = 'warn';
              aiResult.draft.error = String(err && err.message || err);
            }
          }
        }
        if (MESSAGING_OWNER_NOTIFY_NUMBER && phoneKey(MESSAGING_OWNER_NOTIFY_NUMBER) !== phoneKey(inbound.from)) {
          data.messages.unshift({
            id: 'msg-mirror-' + Date.now(),
            date: new Date().toLocaleString('en-US'),
            createdAt: new Date().toISOString(),
            customer: contact.name || inbound.from || 'Unknown texter',
            phone: MESSAGING_OWNER_NOTIFY_NUMBER,
            direction: 'Owner mirror',
            channel: 'SMS',
            template: 'Owner notification',
            subject: 'Customer text mirrored to owner phone',
            status: 'Ready to send',
            tone: 'warn',
            body: 'WheelsonAuto text from ' + (contact.name || inbound.from || 'customer') + ': ' + inbound.body,
            provider: MESSAGING_PROVIDER,
            source: 'WheelsonAuto mirror'
          });
        }
        data.integrations = data.integrations || {};
        data.integrations.messaging = { ...(data.integrations.messaging || {}), ...publicMessagingStatus(data), lastInboundAt: new Date().toISOString(), lastInboundFrom: maskPhone(inbound.from), lastError: '' };
        await writeData(data);
      }
      return json(res, 200, { ok: true, received: !exists, customer: contact.name || '', ai: aiResult ? { status: aiResult.draft && aiResult.draft.status, actionType: aiResult.plan && aiResult.plan.actionType, sent: !!aiResult.sent } : null });
    }
    if (url.pathname === '/api/webhooks/email' && req.method === 'POST') {
      if (MESSAGING_WEBHOOK_SECRET && url.searchParams.get('secret') !== MESSAGING_WEBHOOK_SECRET && req.headers['x-woa-webhook-secret'] !== MESSAGING_WEBHOOK_SECRET) {
        return json(res, 401, { ok: false, error: 'Unauthorized webhook.' });
      }
      const rawBody = await readBody(req);
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      const payload = contentType.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(rawBody)) : JSON.parse(rawBody || '{}');
      const inbound = parseIncomingEmail(url.searchParams.get('provider'), req.headers, payload);
      const data = await readData();
      const contact = findMessageContact(data, { email: inbound.from });
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      const exists = inbound.externalId && data.messages.some(item => item.externalId === inbound.externalId);
      let inboundRecord = null;
      let aiResult = null;
      if (!exists) {
        inboundRecord = {
          id: 'msg-email-in-' + Date.now(),
          externalId: inbound.externalId,
          date: new Date().toLocaleString('en-US'),
          createdAt: new Date().toISOString(),
          customer: contact.name || inbound.from || 'Unknown email',
          email: inbound.from,
          to: inbound.to,
          direction: 'Inbound',
          channel: 'Email',
          template: 'Customer email',
          subject: inbound.subject || 'Incoming email',
          status: 'Received',
          tone: 'blue',
          body: inbound.body,
          provider: inbound.provider,
          source: 'Email webhook',
          contactSource: contact.source || ''
        };
        data.messages.unshift(inboundRecord);
        const settings = messageSettings(data);
        if (settings.aiEnabled && settings.aiDrafts && inbound.body) {
          aiResult = await createAiMessageDraft(data, {
            messageId: inboundRecord.id,
            externalId: inbound.externalId || inboundRecord.id,
            customer: inboundRecord.customer,
            email: inbound.from,
            channel: 'Email',
            body: inbound.body
          }, { sourceMessageId: inbound.externalId || inboundRecord.id });
          const plan = aiResult.plan || {};
          if (settings.aiAutoSend && plan.canAutoSend && !plan.approvalRequired && !plan.needsHuman && aiResult.draft && aiResult.draft.email) {
            try {
              const approved = await approveAiMessage(data, { draftId: aiResult.draft.id, channel: 'Email' });
              aiResult.sent = approved.sent;
            } catch (err) {
              aiResult.draft.status = 'Auto-send failed';
              aiResult.draft.tone = 'warn';
              aiResult.draft.error = String(err && err.message || err);
            }
          }
        }
        data.integrations = data.integrations || {};
        data.integrations.messaging = { ...(data.integrations.messaging || {}), ...publicMessagingStatus(data), lastInboundAt: new Date().toISOString(), lastInboundChannel: 'Email', lastInboundFrom: maskEmail(inbound.from), lastError: '' };
        await writeData(data);
      }
      return json(res, 200, { ok: true, received: !exists, customer: contact.name || '', ai: aiResult ? { status: aiResult.draft && aiResult.draft.status, actionType: aiResult.plan && aiResult.plan.actionType, sent: !!aiResult.sent } : null });
    }
    if (url.pathname === '/api/webhooks/clover' && req.method === 'POST') {
      if (CLOVER_WEBHOOK_SECRET && url.searchParams.get('secret') !== CLOVER_WEBHOOK_SECRET && req.headers['x-woa-webhook-secret'] !== CLOVER_WEBHOOK_SECRET && req.headers['x-clover-webhook-secret'] !== CLOVER_WEBHOOK_SECRET) {
        return json(res, 401, { ok: false, error: 'Unauthorized webhook.' });
      }
      const event = JSON.parse(await readBody(req) || '{}');
      return json(res, 200, await recordCloverWebhookEvent(event));
    }
    if (url.pathname === '/customer/login' && req.method === 'GET') return send(res, 200, customerLoginPage(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    if (url.pathname === '/customer/login' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const username = form.get('username') || '';
      const password = form.get('password') || '';
      const data = await readData();
      const account = findCustomerAccountByLogin(data, username, password);
      if (!account) return send(res, 401, customerLoginPage('That customer login did not match an active account.'), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
      return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', customerSessionCookie(account)), Location: '/customer' });
    }
    if (url.pathname === '/customer/forgot' && req.method === 'GET') return send(res, 200, customerForgotPage(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    if (url.pathname === '/customer/forgot' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const identity = String(form.get('identity') || '').trim();
      if (!identity) return send(res, 400, customerForgotPage('Enter your name, username, phone, or email so we can find the account.'), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
      const data = await readData();
      const account = findCustomerAccountByIdentity(data, identity);
      const customer = account && (account.name || account.customer) || identity;
      if (account) {
        account.passwordResetRequestedAt = new Date().toISOString();
        account.passwordResetStatus = 'Requested';
        account.passwordResetIdentity = identity;
      }
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.messages.unshift({
        id: 'msg-customer-reset-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        customer,
        phone: account && account.phone || '',
        email: account && account.email || '',
        direction: 'Customer portal request',
        channel: 'Portal',
        template: 'Password reset request',
        subject: 'Customer portal password help',
        status: account ? 'Needs admin reset' : 'Needs account match',
        tone: account ? 'warn' : 'bad',
        body: 'Customer requested login help for: ' + identity + '. Verify identity before changing the password.',
        source: 'Customer portal',
        event: 'customer_password_reset',
        customerAccountId: account && account.id || ''
      });
      await queueOwnerEmailNotification(data, 'customer_password_reset', {
        customer,
        subject: 'Customer password reset request - ' + customer,
        body: [
          'A customer requested portal login help.',
          'Entered identity: ' + identity,
          'Matched customer: ' + (account ? customer : 'No exact customer login match'),
          'Phone: ' + (account && account.phone || 'Not available'),
          'Email: ' + (account && account.email || 'Not available'),
          'Action: verify the customer, then update their customer portal password from Settings.'
        ].join('\n')
      });
      await writeData(data);
      return send(res, 200, customerForgotPage('Your request was sent to WheelsonAuto. We will verify the account before changing access.'), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/customer/logout') return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
    if (url.pathname === '/customer/message' && req.method === 'POST') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const form = new URLSearchParams(await readBody(req));
      const body = String(form.get('body') || '').trim().slice(0, 1200);
      if (!body) return send(res, 302, '', 'text/plain', { Location: '/customer' });
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && String(item.status || 'Active').toLowerCase() !== 'disabled');
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      const message = {
        id: 'msg-customer-portal-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        customer: account.customer || account.name || 'Customer',
        phone: account.phone || '',
        email: account.email || '',
        direction: 'Inbound',
        channel: 'Customer portal',
        template: 'Customer portal message',
        subject: 'Customer portal message',
        status: 'Received',
        tone: 'blue',
        body,
        source: 'Customer portal',
        customerAccountId: account.id,
        recurringPaymentId: account.recurringPaymentId || '',
        vehicleId: account.vehicleId || ''
      };
      data.messages.unshift(message);
      const settings = messageSettings(data);
      if (settings.aiEnabled && settings.aiDrafts) {
        await createAiMessageDraft(data, {
          messageId: message.id,
          customer: message.customer,
          phone: message.phone,
          email: message.email,
          channel: 'Customer portal',
          body
        }, { sourceMessageId: message.id });
      }
      await queueOwnerEmailNotification(data, 'customer_message', {
        customer: message.customer,
        subject: 'Customer portal message - ' + message.customer,
        body: [
          'A customer sent a message from the WheelsonAuto portal.',
          'Customer: ' + message.customer,
          'Phone: ' + (message.phone || 'Not saved'),
          'Email: ' + (message.email || 'Not saved'),
          'Message: ' + body
        ].join('\n')
      });
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: '/customer' });
    }
    if (url.pathname === '/customer/paid-outside' && req.method === 'POST') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const form = new URLSearchParams(await readBody(req));
      const amount = Number(form.get('amount') || 0);
      const method = String(form.get('method') || 'Outside app').trim().slice(0, 80);
      const paidDate = String(form.get('paidDate') || '').trim();
      const note = String(form.get('note') || '').trim().slice(0, 1200);
      const proofUrl = String(form.get('proofUrl') || form.get('url') || '').trim().slice(0, 500);
      if (!Number.isFinite(amount) || amount <= 0) return send(res, 302, '', 'text/plain', { Location: '/customer' });
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      const portal = customerPortalState(data, account);
      const recurring = portal.recurring || {};
      let vehicle = portal.vehicle || {};
      const summary = portal.summary || {};
      const customerName = summary.customer || account.customer || account.name || 'Customer';
      const customerRecord = (data.customers || []).find(row => normKey(row.name || row.customer) === normKey(customerName)) || {};
      const contractRecord = (data.contracts || []).find(row => normKey(row.customer || row.name) === normKey(customerName)) || {};
      if (!vehicle.id) vehicle = (data.vehicles || []).find(row => row.id === (account.vehicleId || recurring.vehicleId || customerRecord.vehicleId || contractRecord.vehicleId || '')) || (data.vehicles || []).find(row => [recurring.vehicle, customerRecord.vehicle, contractRecord.vehicle, summary.vehicle].some(name => name && normKey(vehicleNameFromParts(row)) === normKey(name))) || {};
      const vehicleName = vehicle.id ? vehicleNameFromParts(vehicle) : (summary.vehicle || recurring.vehicle || '');
      const tag = summary.tag || vehicle.plate || vehicle.stock || recurring.licensePlate || recurring.plate || '';
      const payment = {
        id: 'paid-outside-review-' + Date.now(),
        date: paidDate || new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: account.phone || '',
        email: account.email || '',
        vehicle: vehicleName,
        vehicleId: account.vehicleId || vehicle.id || recurring.vehicleId || '',
        vin: summary.vin || vehicle.vin || recurring.vin || '',
        licensePlate: tag,
        plate: tag,
        tempTag: vehicle.tempTag || recurring.tempTag || '',
        tracker: summary.tracker || vehicle.tracker || recurring.tracker || '',
        recurringPaymentId: recurring.id || account.recurringPaymentId || '',
        cloverCustomerId: recurring.cloverCustomerId || '',
        method: method + ' outside app',
        amount,
        status: 'Paid outside app - needs verification',
        tone: 'warn',
        source: 'Customer portal',
        notes: note || 'Customer reported an outside-app payment from the portal.',
        proof: proofUrl || note || '',
        proofUrl,
        url: proofUrl,
        requiresVerification: true,
        customerAccountId: account.id
      };
      data.payments = Array.isArray(data.payments) ? data.payments : [];
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.payments.unshift(payment);
      const message = {
        id: 'msg-customer-paid-outside-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: payment.phone,
        email: payment.email,
        direction: 'Customer action',
        channel: 'Customer portal',
        template: 'Paid outside app',
        subject: 'Customer reported outside payment',
        status: 'Needs admin verification',
        tone: 'warn',
        body: [
          'Customer reported a payment outside WheelsonAuto.',
          'Amount: ' + moneyText(amount),
          'Method: ' + method,
          'Payment date: ' + (paidDate || 'Not specified'),
          'Vehicle: ' + (vehicleName || 'Not linked'),
          tag ? 'Tag/plate: ' + tag : '',
          proofUrl ? 'Proof link/note: ' + proofUrl : '',
          'Note/proof: ' + (note || 'No proof note provided')
        ].filter(Boolean).join('\n'),
        source: 'Customer portal',
        customerAccountId: account.id,
        paymentId: payment.id,
        recurringPaymentId: payment.recurringPaymentId,
        vehicleId: payment.vehicleId
      };
      data.messages.unshift(message);
      await queueOwnerEmailNotification(data, 'customer_message', {
        customer: customerName,
        subject: 'Paid outside app needs verification - ' + customerName,
        body: message.body
      });
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: '/customer' });
    }
    if (url.pathname === '/customer/service-request' && req.method === 'POST') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const form = new URLSearchParams(await readBody(req));
      const type = String(form.get('type') || 'Service request').trim().slice(0, 120);
      const preferredDate = String(form.get('preferredDate') || '').trim();
      const notes = String(form.get('notes') || '').trim().slice(0, 1200);
      const proofUrl = String(form.get('proofUrl') || form.get('url') || '').trim().slice(0, 500);
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      const scopedData = dataScopedToOrganization(data, account.organizationId || MAIN_ORG_ID);
      const context = aiFindCustomerContext(scopedData, {
        customer: account.customer || account.name,
        phone: account.phone,
        email: account.email,
        recurringPaymentId: account.recurringPaymentId,
        id: account.recurringPaymentId
      });
      const customerName = context.customerName || account.customer || account.name || 'Customer';
      const vehicle = context.vehicle || {};
      const recurring = context.recurring || {};
      const vehicleName = context.vehicleName || recurring.vehicle || 'Vehicle not linked';
      const tag = vehicle.plate || vehicle.stock || recurring.licensePlate || recurring.plate || '';
      const due = preferredDate || localDateKey();
      data.maintenance = Array.isArray(data.maintenance) ? data.maintenance : [];
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      const service = {
        id: 'mnt-customer-portal-' + Date.now(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: account.phone || context.phone || '',
        email: account.email || context.email || '',
        vehicle: vehicleName,
        vehicleId: account.vehicleId || vehicle.id || recurring.vehicleId || '',
        vin: vehicle.vin || recurring.vin || '',
        licensePlate: tag,
        plate: tag,
        tempTag: vehicle.tempTag || recurring.tempTag || '',
        tracker: vehicle.tracker || recurring.tracker || '',
        type,
        issue: type,
        due,
        nextDue: due,
        status: 'Customer requested',
        tone: 'warn',
        cost: 0,
        source: 'Customer portal',
        customerAccountId: account.id,
        proofUrl,
        url: proofUrl,
        evidence: proofUrl,
        notes: notes || 'Customer requested service from the WheelsonAuto portal.',
        createdAt: new Date().toISOString()
      };
      data.maintenance.unshift(service);
      const message = {
        id: 'msg-customer-service-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: service.phone,
        email: service.email,
        direction: 'Customer action',
        channel: 'Customer portal',
        template: 'Service request',
        subject: type,
        status: 'Service requested',
        tone: 'warn',
        body: [type, vehicleName, tag ? 'Tag/plate: ' + tag : '', proofUrl ? 'Proof link/note: ' + proofUrl : '', notes].filter(Boolean).join('\n'),
        source: 'Customer portal',
        customerAccountId: account.id,
        maintenanceId: service.id,
        vehicleId: service.vehicleId
      };
      data.messages.unshift(message);
      await queueOwnerEmailNotification(data, 'maintenance_due', {
        customer: customerName,
        subject: 'Customer service request - ' + customerName,
        body: [
          'A customer requested service from the WheelsonAuto portal.',
          'Customer: ' + customerName,
          'Vehicle: ' + vehicleName,
          'VIN: ' + (service.vin || 'Not linked'),
          'Tag/plate: ' + (tag || 'Not linked'),
          'Type: ' + type,
          'Preferred date: ' + due,
          'Proof link/note: ' + (proofUrl || 'No proof link provided'),
          'Notes: ' + (notes || 'No notes')
        ].join('\n')
      });
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: '/customer' });
    }
    if (url.pathname === '/customer/issue-report' && req.method === 'POST') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const form = new URLSearchParams(await readBody(req));
      const type = String(form.get('type') || 'Customer issue').trim().slice(0, 120);
      const incidentDate = String(form.get('incidentDate') || '').trim();
      const amount = Number(form.get('amount') || 0);
      const notes = String(form.get('notes') || '').trim().slice(0, 1200);
      const proofUrl = String(form.get('proofUrl') || form.get('url') || '').trim().slice(0, 500);
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      const scopedData = dataScopedToOrganization(data, account.organizationId || MAIN_ORG_ID);
      const context = aiFindCustomerContext(scopedData, {
        customer: account.customer || account.name,
        phone: account.phone,
        email: account.email,
        recurringPaymentId: account.recurringPaymentId,
        id: account.recurringPaymentId
      });
      const recurring = context.recurring || {};
      const vehicle = context.vehicle || {};
      const customerName = context.customerName || account.customer || account.name || 'Customer';
      const vehicleName = context.vehicleName || recurring.vehicle || '';
      const tag = vehicle.plate || vehicle.stock || recurring.licensePlate || recurring.plate || '';
      const claim = {
        id: 'claim-customer-portal-' + Date.now(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: account.phone || context.phone || '',
        email: account.email || context.email || '',
        vehicle: vehicleName,
        vehicleId: account.vehicleId || vehicle.id || recurring.vehicleId || '',
        vin: vehicle.vin || recurring.vin || '',
        plate: tag,
        reference: tag,
        tempTag: vehicle.tempTag || recurring.tempTag || '',
        tracker: vehicle.tracker || recurring.tracker || '',
        type,
        source: 'Customer portal',
        provider: /toll|ez/i.test(type) ? 'E-ZPass / toll notice' : 'Customer report',
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        status: 'Customer reported - review',
        tone: 'warn',
        responsibility: 'Unknown',
        incidentDate: incidentDate || localDateKey(),
        nextFollowUp: localDateKey(),
        evidence: proofUrl || notes || '',
        proofUrl,
        url: proofUrl,
        notes: notes || 'Customer reported an issue from the WheelsonAuto portal.',
        customerAccountId: account.id,
        recurringPaymentId: recurring.id || account.recurringPaymentId || '',
        customerMatchStatus: 'Matched from customer portal',
        customerMatchSource: 'Customer portal login',
        createdAt: new Date().toISOString()
      };
      data.claims = Array.isArray(data.claims) ? data.claims : [];
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.claims.unshift(claim);
      const message = {
        id: 'msg-customer-issue-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: claim.phone,
        email: claim.email,
        direction: 'Customer action',
        channel: 'Customer portal',
        template: 'Issue report',
        subject: type,
        status: 'Claim/issue review needed',
        tone: 'warn',
        body: [
          'Customer reported a claim/toll/issue from the portal.',
          'Type: ' + type,
          'Amount shown: ' + moneyText(claim.amount || 0),
          'Incident date: ' + claim.incidentDate,
          'Vehicle: ' + (vehicleName || 'Not linked'),
          tag ? 'Tag/plate: ' + tag : '',
          proofUrl ? 'Proof link/note: ' + proofUrl : '',
          'Note/proof: ' + (notes || 'No proof note provided')
        ].filter(Boolean).join('\n'),
        source: 'Customer portal',
        customerAccountId: account.id,
        claimId: claim.id,
        vehicleId: claim.vehicleId
      };
      data.messages.unshift(message);
      await queueOwnerEmailNotification(data, 'claim_dispute', {
        customer: customerName,
        subject: 'Customer issue report - ' + customerName,
        body: message.body
      });
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: '/customer' });
    }
    if (url.pathname === '/customer/document-update' && req.method === 'POST') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const form = new URLSearchParams(await readBody(req));
      const type = String(form.get('type') || 'Document update').trim().slice(0, 120);
      const provider = String(form.get('provider') || '').trim().slice(0, 120);
      const reference = String(form.get('reference') || '').trim().slice(0, 160);
      const expires = String(form.get('expires') || '').trim().slice(0, 40);
      const proofUrl = String(form.get('proofUrl') || form.get('url') || '').trim().slice(0, 500);
      const notes = String(form.get('notes') || '').trim().slice(0, 1200);
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      const scopedData = dataScopedToOrganization(data, account.organizationId || MAIN_ORG_ID);
      const context = aiFindCustomerContext(scopedData, {
        customer: account.customer || account.name,
        phone: account.phone,
        email: account.email,
        recurringPaymentId: account.recurringPaymentId,
        id: account.recurringPaymentId
      });
      const recurring = context.recurring || {};
      const vehicle = context.vehicle || {};
      const customerName = context.customerName || account.customer || account.name || 'Customer';
      const vehicleName = context.vehicleName || recurring.vehicle || '';
      const tag = vehicle.plate || vehicle.stock || recurring.licensePlate || recurring.plate || '';
      const document = {
        id: 'doc-customer-portal-' + Date.now(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: account.phone || context.phone || '',
        email: account.email || context.email || '',
        vehicle: vehicleName,
        vehicleId: account.vehicleId || vehicle.id || recurring.vehicleId || '',
        vin: vehicle.vin || recurring.vin || '',
        licensePlate: tag,
        plate: tag,
        tempTag: vehicle.tempTag || recurring.tempTag || '',
        tracker: vehicle.tracker || recurring.tracker || '',
        type,
        title: type + ' update',
        kind: 'Document',
        status: 'Needs verification',
        tone: 'warn',
        provider,
        agency: provider,
        reference,
        url: proofUrl,
        proofUrl,
        expires,
        date: localDateKey(),
        createdAt: new Date().toISOString(),
        source: 'Customer portal',
        visibility: 'Customer portal',
        customerVisible: true,
        portalVisible: true,
        requiresVerification: true,
        verifiedBy: '',
        verifiedAt: '',
        notes: notes || 'Customer sent a document/proof update from the portal.',
        internalNotes: 'Customer-submitted document update needs staff verification before the account is marked complete.',
        customerAccountId: account.id,
        recurringPaymentId: recurring.id || account.recurringPaymentId || ''
      };
      data.documents = Array.isArray(data.documents) ? data.documents : [];
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.documents.unshift(document);
      const message = {
        id: 'msg-customer-document-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: document.phone,
        email: document.email,
        direction: 'Customer action',
        channel: 'Customer portal',
        template: 'Document update',
        subject: type + ' needs verification',
        status: 'Needs admin verification',
        tone: 'warn',
        body: [
          'Customer sent a document/proof update from the portal.',
          'Type: ' + type,
          provider ? 'Provider/agency: ' + provider : '',
          reference ? 'Reference: ' + reference : '',
          proofUrl ? 'Proof link/note: ' + proofUrl : '',
          expires ? 'Expiration/due date: ' + expires : '',
          'Vehicle: ' + (vehicleName || 'Not linked'),
          document.vin ? 'VIN: ' + document.vin : '',
          tag ? 'Tag/plate: ' + tag : '',
          'Note/proof: ' + (notes || 'No note provided')
        ].filter(Boolean).join('\n'),
        source: 'Customer portal',
        customerAccountId: account.id,
        documentId: document.id,
        recurringPaymentId: document.recurringPaymentId,
        vehicleId: document.vehicleId
      };
      data.messages.unshift(message);
      await queueOwnerEmailNotification(data, 'customer_message', {
        customer: customerName,
        subject: type + ' verification needed - ' + customerName,
        body: message.body
      });
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: '/customer' });
    }
    if (url.pathname === '/customer/card-change' && req.method === 'POST') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      const scopedData = dataScopedToOrganization(data, account.organizationId || MAIN_ORG_ID);
      const context = aiFindCustomerContext(scopedData, {
        customer: account.customer || account.name,
        phone: account.phone,
        email: account.email,
        recurringPaymentId: account.recurringPaymentId,
        id: account.recurringPaymentId
      });
      const recurring = context.recurring || {};
      const customerName = context.customerName || account.customer || account.name || 'Customer';
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      if (!recurring.id && !account.recurringPaymentId) {
        const message = {
          id: 'msg-customer-card-review-' + Date.now(),
          date: new Date().toLocaleString('en-US'),
          createdAt: new Date().toISOString(),
          organizationId: account.organizationId || MAIN_ORG_ID,
          customer: customerName,
          phone: account.phone || context.phone || '',
          email: account.email || context.email || '',
          direction: 'Customer action',
          channel: 'Customer portal',
          template: 'Card change review',
          subject: 'Customer requested card change - review needed',
          status: 'Review needed',
          tone: 'warn',
          body: 'Customer requested a card change, but no linked recurring payment was found. Staff should open the customer file and send the correct setup link.',
          source: 'Customer portal',
          customerAccountId: account.id,
          vehicleId: account.vehicleId || context.vehicle && context.vehicle.id || ''
        };
        data.messages.unshift(message);
        await queueOwnerEmailNotification(data, 'customer_message', {
          customer: customerName,
          subject: 'Card change review needed - ' + customerName,
          body: message.body
        });
        await writeData(data);
        return send(res, 302, '', 'text/plain', { Location: '/customer' });
      }
      const setup = createCardSetupRequest(data, {
        id: recurring.id || account.recurringPaymentId,
        recurringPaymentId: recurring.id || account.recurringPaymentId,
        organizationId: account.organizationId || MAIN_ORG_ID,
        reactivateExisting: true,
        cardOnlyUpdate: true,
        customer: customerName,
        phone: account.phone || context.phone || recurring.phone || '',
        email: account.email || context.email || recurring.email || '',
        vehicle: context.vehicleName || recurring.vehicle || '',
        vehicleId: account.vehicleId || context.vehicle && context.vehicle.id || recurring.vehicleId || '',
        vin: context.vehicle && context.vehicle.vin || recurring.vin || '',
        licensePlate: context.vehicle && (context.vehicle.plate || context.vehicle.licensePlate) || recurring.licensePlate || recurring.plate || '',
        tempTag: context.vehicle && context.vehicle.tempTag || recurring.tempTag || '',
        tracker: context.vehicle && context.vehicle.tracker || recurring.tracker || '',
        amount: Number(recurring.amount || recurring.weeklyAmount || context.customer && context.customer.weeklyAmount || 0),
        frequency: recurring.frequency || 'Weekly',
        nextRun: recurring.nextRun || localDateKey(),
        chargeTime: recurring.chargeTime || recurring.paymentTime || '18:00',
        reason: 'Customer portal card change request',
        notes: 'Customer requested to change card on file from the WheelsonAuto portal.'
      });
      data.messages.unshift({
        id: 'msg-customer-card-change-' + Date.now(),
        date: new Date().toLocaleString('en-US'),
        createdAt: new Date().toISOString(),
        organizationId: account.organizationId || MAIN_ORG_ID,
        customer: customerName,
        phone: account.phone || context.phone || '',
        email: account.email || context.email || '',
        direction: 'Customer action',
        channel: 'Customer portal',
        template: 'Card change link',
        subject: 'Customer opened card change link',
        status: 'Setup link opened',
        tone: 'blue',
        body: 'Customer opened a secure card setup/change link from the customer portal.',
        source: 'Customer portal',
        customerAccountId: account.id,
        recurringPaymentId: setup.request.recurringPaymentId || recurring.id || '',
        cardSetupRequestId: setup.request.id,
        vehicleId: setup.request.vehicleId || ''
      });
      await queueOwnerEmailNotification(data, 'customer_message', {
        customer: customerName,
        subject: 'Customer opened card setup link - ' + customerName,
        body: 'Customer opened a secure card setup/change link from the WheelsonAuto portal: ' + setup.request.url
      });
      await writeData(data);
      return send(res, 302, '', 'text/plain', { Location: '/setup-card/' + encodeURIComponent(setup.request.id) });
    }
    if (url.pathname === '/customer' && req.method === 'GET') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return send(res, 302, '', 'text/plain', { Location: '/customer/login' });
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_customer_session', '', { maxAge: 0 }), Location: '/customer/login' });
      return send(res, 200, customerPortalHtml(account, customerPortalState(data, account)), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/customer/portal-state' && req.method === 'GET') {
      const customerUser = customerSessionUser(req);
      if (!customerUser) return json(res, 401, { ok: false, error: 'Customer login required.' });
      const data = await readData();
      const account = (data.customerAccounts || []).find(item => item.id === customerUser.id && staffStatusActive(item));
      if (!account) return json(res, 401, { ok: false, error: 'Customer account is not active.' });
      return json(res, 200, { ok: true, portal: customerPortalState(data, account) });
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const username = form.get('username') || '';
      const password = form.get('password') || '';
      const pin = form.get('pin') || '';
      if (ownerLoginMatches(username, password, pin)) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_session', sessionCookie({ id: 'owner', username: LOGIN_USERNAME || 'admin', name: 'Owner admin', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' })), Location: '/' });
      const data = await readData();
      if (storedOwnerLoginMatches(data, username, password)) return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_session', sessionCookie({ id: 'owner', username: (data.security && data.security.ownerLogin && data.security.ownerLogin.username) || LOGIN_USERNAME || 'admin', name: 'Owner admin', role: 'Owner', homeView: 'Dashboard', access: 'Full platform access' })), Location: '/' });
      const staff = findStaffByLogin(data, username, password) || findStaffByPin(data, pin);
      if (staff) {
        const user = staffLoginUser(staff);
        user.companyName = companyNameById(data, user.organizationId);
        return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_session', sessionCookie(user)), Location: '/' });
      }
      return send(res, 401, loginPage('That login did not match an active account.'));
    }
    if (url.pathname === '/logout') return send(res, 302, '', 'text/plain', { 'Set-Cookie': sessionSetCookie('woa_session', '', { maxAge: 0 }), Location: '/' });
    const user = sessionUser(req);
    if (!user) return send(res, 200, loginPage());
    if (url.pathname.startsWith('/api/') && !apiAllowedForUser(user, url.pathname)) return json(res, 403, { ok: false, error: 'This account does not have access to that action.' });
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, stateForUserRead(await readData(), user));
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const incoming = JSON.parse(await readBody(req) || '{}');
      const current = await readData();
      const nextState = stateForUserWrite(current, incoming, user);
      await queueStateChangeNotifications(current, nextState, user);
      appendAuditLog(nextState, user, 'Platform state saved', auditChangedSections(current, nextState));
      await writeData(nextState);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/messages/status' && req.method === 'GET') {
      const data = await readData();
      return json(res, 200, { ok: true, messaging: publicMessagingStatus(data) });
    }
    if (url.pathname === '/api/messages/settings' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner can change messaging and Star AI settings.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.messaging = data.integrations.messaging || {};
      ['enabled', 'aiEnabled', 'aiAutoSend', 'aiDrafts', 'emailEnabled'].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(payload, key)) data.integrations.messaging[key] = payload[key] !== false;
      });
      data.integrations.messaging.updatedAt = new Date().toISOString();
      data.integrations.messaging = { ...data.integrations.messaging, ...publicMessagingStatus(data) };
      await writeData(data);
      return json(res, 200, { ok: true, messaging: data.integrations.messaging });
    }
    if (url.pathname === '/api/notifications/email/settings' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner can change email notification settings.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.integrations = data.integrations || {};
      data.integrations.notifications = data.integrations.notifications || {};
      const recipients = Array.isArray(payload.emailRecipients) ? payload.emailRecipients : String(payload.emailRecipients || payload.emailTo || '').split(',');
      data.integrations.notifications.emailRecipients = recipients.map(item => String(item || '').trim()).filter(Boolean);
      if (Object.prototype.hasOwnProperty.call(payload, 'emailEnabled')) data.integrations.notifications.emailEnabled = payload.emailEnabled !== false;
      data.integrations.notifications.events = Array.isArray(payload.events) && payload.events.length ? payload.events.map(String) : emailNotificationSettings(data).events;
      data.integrations.notifications.updatedAt = new Date().toISOString();
      await writeData(data);
      return json(res, 200, { ok: true, notifications: emailNotificationSettings(data), messaging: publicMessagingStatus(data) });
    }
    if (url.pathname === '/api/notifications/email/test' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner can send email notification tests.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const settings = emailNotificationSettings(data);
      const result = await queueEmailNotification(data, {
        to: payload.to || payload.email || settings.emailRecipients[0],
        subject: payload.subject || 'WheelsonAuto email notification test',
        body: payload.body || 'This is a WheelsonAuto notification test. If email is not connected yet, this stays saved as a draft in Messages.',
        event: payload.event || 'manual_test',
        customer: payload.customer || 'WheelsonAuto'
      });
      await writeData(data);
      return json(res, result.sent ? 200 : 202, { ok: true, sent: result.sent, message: result.message, warning: result.result.message || '', notifications: emailNotificationSettings(data), messaging: publicMessagingStatus(data) });
    }
    if (url.pathname === '/api/notifications/daily-closeout' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner can send daily closeout notifications.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const settings = emailNotificationSettings(data);
      if (!settings.emailRecipients.length) return json(res, 400, { ok: false, error: 'Add a notification email in Messages setup first.' });
      const dateKeyValue = payload.dateKey || localDateKey();
      if (String(payload.ownerNote || '').trim()) {
        data.dailyCloseouts = Array.isArray(data.dailyCloseouts) ? data.dailyCloseouts : [];
        let noteRow = data.dailyCloseouts.find(row => row.dateKey === dateKeyValue);
        if (!noteRow) {
          noteRow = { id: 'closeout-' + dateKeyValue, dateKey: dateKeyValue };
          data.dailyCloseouts.unshift(noteRow);
        }
        noteRow.note = String(payload.ownerNote || '').trim();
        noteRow.updatedAt = new Date().toISOString();
        noteRow.updatedBy = user.name || user.role || 'Owner';
      }
      const closeout = dailyCloseoutNotificationPayload(data, dateKeyValue, payload.ownerNote || '');
      const result = await queueOwnerEmailNotification(data, 'daily_closeout', closeout);
      if (!result) return json(res, 409, { ok: false, error: 'Daily closeout notifications are turned off in notification settings.' });
      await writeData(data);
      return json(res, result.sent ? 200 : 202, { ok: true, sent: result.sent, message: result.message, summary: closeout.summary, warning: result.result.message || '' });
    }
    if (url.pathname === '/api/verification/document' && req.method === 'POST') {
      const role = String(user && user.role || '').toLowerCase();
      if (!isOwnerUser(user) && role !== 'manager') return json(res, 403, { ok: false, error: 'Only owner or manager accounts can verify customer proof.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      try {
        const document = reviewDocumentProof(data, user, payload);
        appendAuditLog(data, user, document.status === 'Verified' ? 'Document proof verified' : 'Document proof rejected', [document.customer || 'Unassigned', document.type || 'Document', document.vehicle || document.vin || 'No vehicle linked']);
        await writeData(data);
        return json(res, 200, { ok: true, document });
      } catch (err) {
        return json(res, err.status || 400, { ok: false, error: String(err && err.message || err) });
      }
    }
    if (url.pathname === '/api/verification/paid-outside' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner can verify paid-outside payment reports.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      try {
        const payment = reviewPaidOutsideProof(data, user, payload);
        appendAuditLog(data, user, payment.status === 'Paid outside app' ? 'Paid-outside payment verified' : 'Paid-outside payment rejected', [payment.customer || 'Unassigned', moneyText(payment.amount || 0), payment.vehicle || payment.vin || 'No vehicle linked']);
        await writeData(data);
        return json(res, 200, { ok: true, payment });
      } catch (err) {
        return json(res, err.status || 400, { ok: false, error: String(err && err.message || err) });
      }
    }
    if (url.pathname === '/api/messages/send' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.integrations = data.integrations || {};
      const contact = findMessageContact(data, payload);
      const channel = String(payload.channel || payload.deliveryChannel || 'SMS').toLowerCase() === 'email' ? 'Email' : 'SMS';
      const phone = payload.phone || contact.phone || '';
      const email = payload.email || contact.email || '';
      const to = channel === 'Email' ? email : phone;
      const body = String(payload.body || payload.message || '').trim();
      const customer = payload.customer || contact.name || 'Customer';
      if (!body) return json(res, 400, { ok: false, error: 'Message body is required.' });
      let result;
      try {
        const settings = messageSettings(data);
        result = channel === 'Email'
          ? await sendProviderEmail(to, payload.subject || payload.template || 'WheelsonAuto message', body, { customer, messagingSettings: settings })
          : await sendProviderSms(to, body, { customer, messagingSettings: settings });
        const record = {
          id: 'msg-out-' + Date.now(),
          externalId: result.externalId || '',
          date: new Date().toLocaleString('en-US'),
          createdAt: new Date().toISOString(),
          customer,
          phone,
          email,
          to,
          direction: 'Outbound',
          channel,
          template: payload.template || payload.subject || 'Manual message',
          subject: payload.subject || payload.template || 'Manual message',
          status: result.sent ? (result.status || 'Sent') : (result.status || 'Ready to send'),
          tone: result.sent ? 'good' : 'warn',
          body,
          provider: result.provider || (channel === 'Email' ? WOA_EMAIL_PROVIDER : MESSAGING_PROVIDER) || 'not_configured',
          source: result.sent ? (channel + ' provider') : 'WheelsonAuto draft',
          ownerMirror: channel === 'SMS' && !!MESSAGING_OWNER_NOTIFY_NUMBER,
          paymentId: payload.paymentId || '',
          recurringPaymentId: payload.recurringPaymentId || '',
          claimId: payload.claimId || ''
        };
        data.messages.unshift(record);
        data.integrations.messaging = { ...(data.integrations.messaging || {}), ...publicMessagingStatus(data), lastOutboundAt: new Date().toISOString(), lastOutboundTo: channel === 'Email' ? maskEmail(to) : maskPhone(to), lastError: '' };
        await writeData(data);
        return json(res, result.sent ? 200 : 202, { ok: true, sent: !!result.sent, message: record, provider: result.provider, warning: result.message || '' });
      } catch (err) {
        const record = {
          id: 'msg-out-failed-' + Date.now(),
          date: new Date().toLocaleString('en-US'),
          createdAt: new Date().toISOString(),
          customer,
          phone,
          email,
          direction: 'Outbound',
          channel,
          template: payload.template || payload.subject || 'Manual message',
          subject: payload.subject || payload.template || 'Manual message',
          status: 'Failed',
          tone: 'bad',
          body,
          provider: channel === 'Email' ? (WOA_EMAIL_PROVIDER || 'not_configured') : (MESSAGING_PROVIDER || 'not_configured'),
          source: channel + ' provider',
          paymentId: payload.paymentId || '',
          recurringPaymentId: payload.recurringPaymentId || '',
          claimId: payload.claimId || '',
          error: String(err && err.message || err)
        };
        data.messages.unshift(record);
        data.integrations.messaging = { ...(data.integrations.messaging || {}), ...publicMessagingStatus(data), lastError: record.error, lastFailedAt: new Date().toISOString() };
        await writeData(data);
        return json(res, 502, { ok: false, error: record.error, message: record });
      }
    }
    if (url.pathname === '/api/messages/ai-reply' && req.method === 'POST') {
      if (!WOA_STAR_AI_ENABLED) return json(res, 423, { ok: false, error: 'Star AI is turned off in Render with WOA_STAR_AI_ENABLED=0.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      if (!messageSettings(data).aiEnabled) return json(res, 423, { ok: false, error: 'Star AI is turned off in WheelsonAuto messaging settings.' });
      const sourceMessage = payload.messageId ? (data.messages || []).find(item => item.id === payload.messageId) : null;
      const request = {
        ...payload,
        customer: payload.customer || (sourceMessage && sourceMessage.customer) || '',
        phone: payload.phone || (sourceMessage && (sourceMessage.phone || sourceMessage.from || sourceMessage.to)) || '',
        email: payload.email || (sourceMessage && sourceMessage.email) || '',
        channel: payload.channel || (sourceMessage && sourceMessage.channel === 'Email' ? 'Email' : ''),
        body: payload.body || payload.message || (sourceMessage && sourceMessage.body) || ''
      };
      const aiResult = await createAiMessageDraft(data, request, { sourceMessageId: payload.messageId || payload.externalId || '', forceNew: payload.forceNew === true, user });
      data.integrations = data.integrations || {};
      data.integrations.messaging = { ...(data.integrations.messaging || {}), ...publicMessagingStatus(data), lastAiDraftAt: new Date().toISOString(), lastError: '' };
      await writeData(data);
      return json(res, 201, { ok: true, plan: aiResult.plan, draft: aiResult.draft, existing: aiResult.existing });
    }
    if (url.pathname === '/api/messages/ai-action' && req.method === 'POST') {
      if (!WOA_STAR_AI_ENABLED) return json(res, 423, { ok: false, error: 'Star AI is turned off in Render with WOA_STAR_AI_ENABLED=0.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      if (!messageSettings(data).aiEnabled) return json(res, 423, { ok: false, error: 'Star AI is turned off in WheelsonAuto messaging settings.' });
      try {
        const approved = await approveAiMessage(data, payload);
        data.integrations = data.integrations || {};
        data.integrations.messaging = { ...(data.integrations.messaging || {}), ...publicMessagingStatus(data), lastAiApprovalAt: new Date().toISOString(), lastError: '' };
        appendAuditLog(data, user, 'Star AI reply approved', [approved.sent.customer || approved.draft.customer || 'Unknown customer', approved.sent.channel || approved.draft.deliveryChannel || 'Message', approved.sent.status || 'Draft saved']);
        await writeData(data);
        return json(res, approved.result.sent ? 200 : 202, { ok: true, sent: !!approved.result.sent, message: approved.sent, draft: approved.draft, warning: approved.result.message || '' });
      } catch (err) {
        return json(res, 409, { ok: false, error: String(err && err.message || err) });
      }
    }
    if (url.pathname === '/api/import/vehicle-sheet' && req.method === 'POST') {
      const data = await readData();
      const imported = await mergeVehicleImport(data);
      appendAuditLog(data, user, 'Vehicle sheet imported', ['Rows: ' + (imported.rows || 0), 'Customers: ' + (imported.customers || 0), 'Contracts: ' + (imported.contracts || 0), 'Recurring linked: ' + (imported.recurringLinked || 0), 'Maintenance rows: ' + (imported.maintenanceImported || 0)]);
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
    if (url.pathname === '/api/system/health' && req.method === 'GET') {
      const data = await readData();
      return json(res, 200, systemHealthSnapshot(data, user));
    }
    if (url.pathname === '/api/reports/deep.csv' && req.method === 'GET') {
      const data = await readData();
      return send(res, 200, deepReportCsv(data, user), 'text/csv; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="wheelsonauto-deep-report-' + localDateKey() + '.csv"',
        'Cache-Control': 'no-store'
      });
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
      appendAuditLog(data, user, 'Full sync completed', ['Payments: ' + (synced.payments || 0), 'Customers: ' + (synced.customers || 0), 'Recurring: ' + (synced.recurring || 0), 'Vehicle sheet rows: ' + (vehicleSheet.rows || 0), synced.errors.length ? 'Errors: ' + synced.errors.join('; ') : 'No sync errors']);
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
      if (String(provider.status || '').toLowerCase() === 'connected') {
        const missing = [
          ['env keys', provider.envKeys],
          ['endpoint/route', provider.endpoint],
          ['live test plan', provider.liveTest],
          ['last test result', provider.lastTestResult]
        ].filter(item => !String(item[1] || '').trim()).map(item => item[0]);
        if (missing.length) return json(res, 400, { ok: false, error: 'Connected API systems need ' + missing.join(', ') + ' before they can be marked connected.' });
      }
      const existing = data.apiProviders.find(item => item.id === provider.id);
      if (existing) Object.assign(existing, provider, { createdAt: existing.createdAt || provider.createdAt });
      else data.apiProviders.unshift(provider);
      data.messages = Array.isArray(data.messages) ? data.messages : [];
      data.messages.unshift({ id: 'msg-api-' + Date.now(), date: new Date().toLocaleString('en-US'), customer: provider.name, channel: 'Internal log', template: 'API setup', status: provider.status, subject: provider.group, body: provider.liveTest || provider.notes || '' });
      appendAuditLog(data, user, 'API provider saved', [provider.name, provider.group, provider.status, provider.lastTestResult || provider.liveTest || 'No live test result saved']);
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
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
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
      await writeData(data);
      return json(res, 200, { ok: true, task });
    }
    if (url.pathname === '/api/account/password' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const currentPassword = String(payload.currentPassword || '').trim();
      const newPassword = String(payload.newPassword || '').trim();
      if (newPassword.length < 8) return json(res, 400, { ok: false, error: 'Use at least 8 characters for the new password.' });
      const data = await readData();
      if (!passwordMatchesCurrentUser(data, user, currentPassword)) return json(res, 403, { ok: false, error: 'Current password or PIN did not match.' });
      const record = createPasswordRecord(newPassword);
      if (isOwnerUser(user)) {
        data.security = data.security || {};
        data.security.ownerLogin = {
          username: normalizeLogin(payload.username || user.username || LOGIN_USERNAME || 'admin'),
          ...record
        };
      } else {
        data.staffAccounts = Array.isArray(data.staffAccounts) ? data.staffAccounts : [];
        const staff = data.staffAccounts.find(item => item.id === user.id);
        if (!staff) return json(res, 404, { ok: false, error: 'Staff account was not found.' });
        Object.assign(staff, record, { updatedAt: new Date().toISOString() });
      }
      appendAuditLog(data, user, 'Password changed', [isOwnerUser(user) ? 'Owner login' : 'Staff login ' + (user.name || user.username || user.id), 'Password hash updated']);
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
      await writeData(data);
      return json(res, 200, { ok: true, updatedAt: record.passwordUpdatedAt });
    }
    if (url.pathname === '/api/staff-accounts' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner admin can manage staff logins.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.staffAccounts = Array.isArray(data.staffAccounts) ? data.staffAccounts : [];
      const existing = data.staffAccounts.find(item => item.id === payload.id);
      const staff = cleanStaffAccountPayload(payload, existing);
      if (!staff.username) return json(res, 400, { ok: false, error: 'Enter a username for this staff account.' });
      if (!existing && !staff.passwordHash && !staff.pinHint) return json(res, 400, { ok: false, error: 'Enter a password or temporary PIN for the new staff account.' });
      if (!organizationExists(data, staff.organizationId)) return json(res, 400, { ok: false, error: 'Choose a saved company/store for this staff account.' });
      staff.companyName = companyNameById(data, staff.organizationId);
      const duplicate = data.staffAccounts.find(item => item.id !== staff.id && normalizeLogin(item.username || item.email) === staff.username);
      if (duplicate) return json(res, 409, { ok: false, error: 'That username is already used by another staff account.' });
      if (existing) Object.assign(existing, staff);
      else data.staffAccounts.unshift(staff);
      appendAuditLog(data, user, existing ? 'Staff account updated' : 'Staff account created', [staff.name || staff.username, staff.role, staff.companyName || companyNameById(data, staff.organizationId), staff.status || 'Active']);
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
      await writeData(data);
      const safeStaff = { ...staff };
      delete safeStaff.passwordHash;
      delete safeStaff.passwordSalt;
      return json(res, 200, { ok: true, staff: safeStaff });
    }
    if (url.pathname === '/api/customer-accounts' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner admin can manage customer logins.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      data.customerAccounts = Array.isArray(data.customerAccounts) ? data.customerAccounts : [];
      const existing = data.customerAccounts.find(item => item.id === payload.id);
      const account = cleanCustomerAccountPayload({ ...payload, __data: data }, existing);
      if (!account.username) return json(res, 400, { ok: false, error: 'Enter a username, email, or phone for this customer login.' });
      if (!existing && !account.passwordHash) return json(res, 400, { ok: false, error: 'Enter a password for the new customer login.' });
      const duplicate = data.customerAccounts.find(item => item.id !== account.id && normalizeLogin(item.username || item.email || item.phone) === account.username);
      if (duplicate) return json(res, 409, { ok: false, error: 'That customer login is already used by another account.' });
      if (existing) Object.assign(existing, account);
      else data.customerAccounts.unshift(account);
      appendAuditLog(data, user, existing ? 'Customer login updated' : 'Customer login created', [account.customer || account.name || account.username, account.status || 'Active', account.passwordUpdatedAt ? 'Password set' : 'No new password']);
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
      await writeData(data);
      return json(res, 200, { ok: true, account: safeCustomerAccount(existing || account), loginUrl: PUBLIC_BASE_URL + '/customer/login' });
    }
    if (url.pathname === '/api/organizations' && req.method === 'POST') {
      if (!isOwnerUser(user)) return json(res, 403, { ok: false, error: 'Only the owner admin can manage company accounts.' });
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      ensureBaseOrganization(data);
      const existing = data.organizations.find(item => item.id === payload.id);
      const organization = cleanOrganizationPayload(payload, existing);
      if (!organization.name) return json(res, 400, { ok: false, error: 'Enter a company/store name.' });
      const duplicate = data.organizations.find(item => item.id !== organization.id && normKey(item.name) === normKey(organization.name));
      if (duplicate) return json(res, 409, { ok: false, error: 'That company/store name already exists.' });
      if (existing) Object.assign(existing, organization);
      else data.organizations.unshift(organization);
      appendAuditLog(data, user, existing ? 'Company account updated' : 'Company account created', [organization.name, organization.type, organization.status, organization.dataScope]);
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
      await writeData(data);
      return json(res, 200, { ok: true, organization: existing || organization });
    }
    if (url.pathname === '/api/recurring-payments' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const autopay = cleanAutopayPayload(payload);
      data.recurringPayments = Array.isArray(data.recurringPayments) ? data.recurringPayments : [];
      data.customers = Array.isArray(data.customers) ? data.customers : [];
      data.contracts = Array.isArray(data.contracts) ? data.contracts : [];
      assignAutopayVehicle(data, autopay);
      const customerKey = normKey(autopay.customer);
      const reactivateId = String(payload.recurringPaymentId || payload.id || '').trim();
      const existingAutopay = payload.reactivateExisting ? data.recurringPayments.find(row => (reactivateId && (row.id === reactivateId || row.cardSetupRequestId === reactivateId)) || (customerKey && normKey(row.customer) === customerKey)) : null;
      if (existingAutopay) {
        Object.assign(existingAutopay, autopay, {
          id: existingAutopay.id,
          createdAt: existingAutopay.createdAt || autopay.createdAt,
          reactivatedAt: new Date().toISOString()
        });
      } else data.recurringPayments.unshift(autopay);
      if (autopay.customer && !data.customers.some(c => String(c.name || '').toLowerCase() === autopay.customer.toLowerCase())) {
        const activeAutopay = String(autopay.status || '').toLowerCase() === 'active';
        data.customers.unshift({ id: 'cus-' + Date.now(), name: autopay.customer, phone: autopay.phone, email: autopay.email, vehicle: autopay.vehicle, vehicleId: autopay.vehicleId, vin: autopay.vin, licensePlate: autopay.licensePlate, plate: autopay.plate || autopay.licensePlate, tempTag: autopay.tempTag, tracker: autopay.tracker, weeklyAmount: autopay.amount, amount: autopay.amount, status: activeAutopay ? 'Active' : 'Pending pickup', stage: activeAutopay ? 'Active contract' : 'Pending pickup', contract: 'Autopay setup', balance: 0, source: 'WheelsonAuto', cloverCustomerId: autopay.cloverCustomerId });
      }
      if (autopay.customer && !data.contracts.some(c => normKey(c.customer || c.name) === normKey(autopay.customer))) {
        const activeAutopay = String(autopay.status || '').toLowerCase() === 'active';
        data.contracts.unshift({ id: 'con-autopay-' + Date.now(), customer: autopay.customer, phone: autopay.phone, email: autopay.email, vehicle: autopay.vehicle, vehicleId: autopay.vehicleId, vin: autopay.vin, licensePlate: autopay.licensePlate, plate: autopay.plate || autopay.licensePlate, tempTag: autopay.tempTag, tracker: autopay.tracker, weekly: autopay.amount, balance: 0, status: activeAutopay ? 'Active' : 'Pending pickup', autopay: autopay.status || 'Setup needed', paymentProvider: 'Clover', notes: 'Customer file created from WheelsonAuto autopay setup.', source: 'WheelsonAuto autopay', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      appendAuditLog(data, user, existingAutopay ? 'Autopay reactivated' : 'Autopay created', [autopay.customer || 'Unknown customer', moneyText(autopay.amount || 0), autopay.frequency || 'Schedule', autopay.nextRun || 'No next date', autopay.vehicle || autopay.vin || 'No vehicle linked']);
      await protectConcurrentLocalWrites(data, { preferIncoming: true });
      await writeData(data);
      return json(res, 201, { ok: true, autopay: existingAutopay || autopay, reactivated: !!existingAutopay });
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
      const chargeTime = String(payload.chargeTime || payload.paymentTime || (recurring && (recurring.chargeTime || recurring.paymentTime)) || '18:00').trim();
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
        chargeTime,
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
      appendAuditLog(data, user, 'Autopay schedule updated', [recurring && recurring.customer || id, moneyText(amount !== undefined ? amount : recurring && recurring.amount || 0), frequency, nextRun + ' ' + chargeTime, status]);
      await writeData(data);
      return json(res, 200, { ok: true, nextRun, frequency, amount: amount !== undefined ? amount : recurring && recurring.amount, status, paymentDay, chargeTime, monthlyDay, retryRule, autopayManagedBy: patch.autopayManagedBy, autoChargeEnabled: enableWheelsonAutoCharge });
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
      appendAuditLog(data, user, 'Autopay removed', [id, String(payload.note || 'Removed from WheelsonAuto autopay by admin.').trim()]);
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
      appendAuditLog(data, user, 'Card setup deleted', [recurring && recurring.customer || id, 'Recurring rows removed: ' + deletedRecurring, 'Setup requests removed: ' + deletedRequests]);
      await writeData(data);
      return json(res, 200, { ok: true, deletedRecurring, deletedRequests });
    }
    if (url.pathname === '/api/card-setup-requests' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      const created = createCardSetupRequest(data, payload);
      appendAuditLog(data, user, 'Card setup link created', [created.autopay.customer || payload.customer || 'Unknown customer', moneyText(created.autopay.amount || payload.amount || 0), created.request.url || 'Setup link saved']);
      await writeData(data);
      return json(res, 201, { ok: true, autopay: created.autopay, setupLink: created.request });
    }
    if (url.pathname === '/api/integrations/clover/manual-charge' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const data = await readData();
      try {
        const result = await chargeSavedRecurringCard(data, payload, req);
        appendAuditLog(data, user, 'Manual saved-card charge', [result.charge.customer || result.payment.customer || 'Unknown customer', moneyText(result.payment.amount || payload.amount || 0), result.payment.status || 'Paid', result.payment.vehicle || result.charge.vehicle || 'No vehicle linked']);
        await writeData(data);
        return json(res, 201, { ok: true, charge: result.charge, payment: result.payment });
      } catch (err) {
        const recurring = findRecurringRow(data, payload.recurringPaymentId || payload.id);
        if (recurring && isPaymentNotFoundError(err)) {
          const payment = savePaymentNotFoundResult(data, recurring, payload, err, { source: 'Manual saved-card charge payment not found' });
          appendAuditLog(data, user, 'Manual saved-card charge not found', [recurring.customer || 'Unknown customer', moneyText(payment.amount || payload.amount || 0), String(err && err.message || err)]);
          await protectConcurrentLocalWrites(data);
          await writeData(data);
          return json(res, 409, { ok: false, error: payment.status + ': ' + String(err && err.message || err), payment });
        }
        if (recurring) {
          appendAuditLog(data, user, 'Manual saved-card charge failed', [recurring.customer || 'Unknown customer', moneyText(payload.amount || recurring.amount || 0), String(err && err.message || err)]);
          await writeData(data);
        }
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
      appendAuditLog(data, user, 'Payment link created', [request.customer || 'Unknown customer', moneyText(request.amount || 0), request.reason || request.notes || 'Payment request', request.url || 'No URL']);
      if (payload.createCheckout) {
        await attachCloverCheckout(data, request);
      } else {
        await writeData(data);
      }
      return json(res, 201, { ok: true, paymentLink: request });
    }
    return send(res, 200, await appHtml({ publicMode: false, user }), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  } catch (err) {
    send(res, 500, 'Server error: ' + String(err && err.message || err), 'text/plain; charset=utf-8');
  }
});
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('WheelsonAuto platform running on ' + HOST + ':' + PORT);
    setTimeout(() => runAutoSync({ source: 'startup', force: true }).catch(err => console.error('Startup auto sync failed:', err && err.message || err)), AUTO_SYNC_STARTUP_DELAY_MS);
    setInterval(() => runAutoSync({ source: 'background' }).catch(err => console.error('Background auto sync failed:', err && err.message || err)), AUTO_SYNC_MS);
    setTimeout(() => runWheelsonAutoAutopay({ source: 'startup' }).catch(err => console.error('Startup WOA autopay failed:', err && err.message || err)), AUTO_SYNC_STARTUP_DELAY_MS + 5000);
    setInterval(() => runWheelsonAutoAutopay({ source: 'background' }).catch(err => console.error('Background WOA autopay failed:', err && err.message || err)), WOA_AUTOPAY_MS);
  });
}
module.exports = {
  server,
  repairDataIds,
  repairVehicleSheetLinkConflicts,
  publicMessagingStatus,
  parseIncomingEmail,
  parseIncomingMessage
};
