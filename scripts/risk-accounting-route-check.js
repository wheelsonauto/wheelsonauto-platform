const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch (_) { return null; }
}

class MockRequest extends Readable {
  constructor(method, url, headers, body) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers || {};
    this.body = Buffer.from(body || '');
    this.sent = false;
  }
  _read() {
    if (this.sent) return;
    this.sent = true;
    if (this.body.length) this.push(this.body);
    this.push(null);
  }
}

class MockResponse {
  constructor(done) {
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
    this.done = done;
  }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  end(body = '') {
    this.body += Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
    this.done({
      status: this.statusCode,
      headers: this.headers,
      text: this.body,
      json: parseJson(this.body),
      cookie: this.headers['Set-Cookie'] || this.headers['set-cookie'] || ''
    });
  }
}

async function request(server, method, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.cookie = options.cookie;
  let body = '';
  if (Object.prototype.hasOwnProperty.call(options, 'raw')) {
    body = String(options.raw || '');
    headers['content-type'] = options.contentType || 'application/json';
  } else if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (Object.prototype.hasOwnProperty.call(options, 'json')) {
    body = JSON.stringify(options.json);
    headers['content-type'] = 'application/json';
  }
  headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, headers, body);
    const res = new MockResponse(resolve);
    try { server.emit('request', req, res); } catch (error) { reject(error); }
  });
}

async function login(server, form) {
  const response = await request(server, 'POST', '/login', { form });
  assert(response.status === 302, 'Login failed: ' + response.status + ' ' + response.text.slice(0, 160));
  return String(response.cookie).split(';')[0];
}

async function createStaff(server, ownerCookie, account) {
  const response = await request(server, 'POST', '/api/staff-accounts', { cookie: ownerCookie, json: account });
  assert(response.status === 200 && response.json && response.json.ok, 'Could not create ' + account.role + ' test account.');
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-risk-routes-'));
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '4321';
  process.env.PUBLIC_BASE_URL = 'https://wheelsonauto-platform.onrender.com';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_VERIFICATION_MONITOR_MS = '3600000';
  process.env.CANOPY_CONNECT_ALIAS = 'wheelsonauto-route-check';
  process.env.CANOPY_WEBHOOK_SECRET = 'route-canopy-secret';
  process.env.CHECKR_WEBHOOK_SECRET = 'route-checkr-secret';
  process.env.CHECKR_USE_CASE_CONFIRMED = 'true';
  delete process.env.CHECKR_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');

  try {
    const ownerCookie = await login(server, { pin: '4321' });
    await createStaff(server, ownerCookie, {
      id: 'risk-route-manager', name: 'Risk Route Manager', username: 'risk-route-manager',
      password: 'RiskRouteManager123!', role: 'Manager', organizationId: 'org-wheelsonauto', status: 'Active'
    });
    await createStaff(server, ownerCookie, {
      id: 'risk-route-mechanic', name: 'Risk Route Mechanic', username: 'risk-route-mechanic',
      password: 'RiskRouteMechanic123!', role: 'Mechanic', organizationId: 'org-wheelsonauto', status: 'Active'
    });
    const managerCookie = await login(server, { username: 'risk-route-manager', password: 'RiskRouteManager123!' });
    const mechanicCookie = await login(server, { username: 'risk-route-mechanic', password: 'RiskRouteMechanic123!' });

    const ownerVerification = await request(server, 'GET', '/api/verification/status', { cookie: ownerCookie });
    const managerVerification = await request(server, 'GET', '/api/verification/status', { cookie: managerCookie });
    const mechanicVerification = await request(server, 'GET', '/api/verification/status', { cookie: mechanicCookie });
    assert(ownerVerification.status === 200 && managerVerification.status === 200, 'Owner and manager should be able to read verification status.');
    assert(mechanicVerification.status === 403, 'Mechanics must not receive verification records.');

    const insurance = await request(server, 'POST', '/api/verification/cases', {
      cookie: managerCookie,
      json: {
        type: 'insurance', customer: 'Route Test Customer', phone: '8565550100', email: 'route@example.com',
        vehicleId: 'route-vehicle', vehicle: '2019 Route Test Sedan', vin: 'ROUTEVIN000000001', plate: 'ROUTE-1',
        reference: 'POLICY-PRIVATE-7788', monitoringEnabled: true
      }
    });
    assert(insurance.status === 201 && insurance.json.verificationCase.policyNumberLast4 === '7788', 'Insurance case should retain only the policy last four.');
    assert(!JSON.stringify(insurance.json).includes('POLICY-PRIVATE-7788'), 'Insurance case exposed the full policy number.');
    const insuranceCase = insurance.json.verificationCase;

    const missingConsent = await request(server, 'POST', '/api/verification/cases/start', { cookie: managerCookie, json: { caseId: insuranceCase.id } });
    assert(missingConsent.status === 409, 'Provider start must require explicit customer authorization.');
    const startedInsurance = await request(server, 'POST', '/api/verification/cases/start', { cookie: managerCookie, json: { caseId: insuranceCase.id, consentConfirmed: true } });
    assert(startedInsurance.status === 200 && /^https:\/\/app\.usecanopy\.com\//.test(startedInsurance.json.customerActionUrl), 'Canopy hosted customer link was not created.');
    assert(!startedInsurance.json.customerActionUrl.includes('Route+Test') && !startedInsurance.json.customerActionUrl.includes('route%40example.com'), 'Canopy link must not put customer PII in its URL.');

    const manualInsurance = await request(server, 'POST', '/api/verification/cases', {
      cookie: managerCookie,
      json: { type: 'insurance', customer: 'Manual Route Customer', vehicle: '2020 Manual Sedan', vin: 'MANUALROUTEVIN001', provider: 'Manual', reference: 'MANUAL-POLICY-6644', carrier: 'Route Mutual', insuredName: 'Manual Route Customer', coveredVin: 'MANUALROUTEVIN001', coverageType: 'Full coverage', effectiveAt: '2026-01-01', expiresAt: '2027-01-01' }
    });
    assert(manualInsurance.status === 201 && manualInsurance.json.verificationCase.status === 'Needs staff review', 'Manual insurance should enter the staff review queue.');
    const incompleteManualReview = await request(server, 'POST', '/api/verification/cases/review', { cookie: managerCookie, json: { caseId: manualInsurance.json.verificationCase.id, decision: 'approve', expiresAt: '2027-01-01' } });
    assert(incompleteManualReview.status === 400 && /insured name/i.test(incompleteManualReview.json.error || ''), 'Manual insurance must not approve without the full checklist.');
    const approvedManualReview = await request(server, 'POST', '/api/verification/cases/review', { cookie: managerCookie, json: { caseId: manualInsurance.json.verificationCase.id, decision: 'approve', expiresAt: '2027-01-01', insuredNameConfirmed: true, vehicleConfirmed: true, coverageConfirmed: true, datesConfirmed: true, notes: 'All manual insurance checks completed.' } });
    assert(approvedManualReview.status === 200 && approvedManualReview.json.verificationCase.status === 'Verified', 'Completed manual insurance review should approve.');

    const driverRecord = await request(server, 'POST', '/api/verification/cases', {
      cookie: ownerCookie,
      json: { type: 'driver_record', customer: 'Route Test Customer', email: 'route@example.com', reference: 'LICENSE-PRIVATE-9911' }
    });
    assert(driverRecord.status === 201 && driverRecord.json.verificationCase.referenceLast4 === '9911', 'Driver record should retain only the reference last four.');
    const blockedCheckr = await request(server, 'POST', '/api/verification/cases/start', {
      cookie: ownerCookie,
      json: { caseId: driverRecord.json.verificationCase.id, consentConfirmed: true, permissiblePurposeConfirmed: true }
    });
    assert(blockedCheckr.status === 409 && /credential|configured/i.test(blockedCheckr.json.error || ''), 'Checkr must fail honestly when live credentials are absent.');

    const badCanopy = await request(server, 'POST', '/api/webhooks/canopy', { raw: '{}', headers: { 'canopy-signature': 't=1,s=bad' } });
    const badCheckr = await request(server, 'POST', '/api/webhooks/checkr', { raw: '{}', headers: { 'x-checkr-signature': 'bad' } });
    assert(badCanopy.status === 401 && badCheckr.status === 401, 'Unsigned provider callbacks must be rejected.');

    const canopyPayload = {
      id: 'route-canopy-event-1', event_type: 'MONITORING_RECONNECT', pull_id: 'route-pull-1', sequence: 1,
      meta_data: { verification_case_id: insuranceCase.id, vehicle_id: 'route-vehicle' },
      data: { reconnect_url: 'https://app.usecanopy.com/reconnect/route-test' }, is_monitored: true,
      timestamp: new Date().toISOString()
    };
    const canopyRaw = JSON.stringify(canopyPayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const canopySignature = crypto.createHmac('sha256', 'route-canopy-secret').update(timestamp + '.' + canopyRaw).digest('hex');
    const canopyWebhook = await request(server, 'POST', '/api/webhooks/canopy', {
      raw: canopyRaw,
      headers: { 'canopy-signature': 't=' + timestamp + ',s=' + canopySignature }
    });
    assert(canopyWebhook.status === 200 && canopyWebhook.json.received, 'Signed Canopy monitoring callback was not accepted.');
    assert(canopyWebhook.json.status === 'Customer action required', 'Reconnect event should become a clear customer-action status.');
    const duplicateCanopy = await request(server, 'POST', '/api/webhooks/canopy', {
      raw: canopyRaw,
      headers: { 'canopy-signature': 't=' + timestamp + ',s=' + canopySignature }
    });
    assert(duplicateCanopy.status === 200 && duplicateCanopy.json.duplicate, 'Duplicate provider events must be idempotent.');

    const storedPath = path.join(dataDir, 'data.json');
    const storedData = JSON.parse(await fs.readFile(storedPath, 'utf8'));
    storedData.contracts = storedData.contracts || [];
    storedData.contracts.push({ id: 'route-tax-contract', organizationId: 'org-wheelsonauto', customer: 'Route Tax Customer', startDate: '2026-01-10', endDate: '2026-01-19', status: 'Active' });
    await fs.writeFile(storedPath, JSON.stringify(storedData, null, 2));

    const ownerLedger = await request(server, 'GET', '/api/accounting/ledger', { cookie: ownerCookie });
    const managerLedger = await request(server, 'GET', '/api/accounting/ledger', { cookie: managerCookie });
    const mechanicLedger = await request(server, 'GET', '/api/accounting/ledger', { cookie: mechanicCookie });
    assert(ownerLedger.status === 200 && managerLedger.status === 200, 'Owner and manager should be able to read the accounting ledger.');
    assert(ownerLedger.json.insights && ownerLedger.json.yearSummary && ownerLedger.json.taxCenter && ownerLedger.json.taxCenter.monthly.length === 12 && ownerLedger.json.taxCenter.quarterly.length === 4, 'Accounting ledger should include native insights and monthly, quarterly, and yearly tax preparation.');
    assert(mechanicLedger.status === 403, 'Mechanics must not receive accounting records.');

    const managerTaxSettings = await request(server, 'POST', '/api/accounting/tax-settings', { cookie: managerCookie, json: { salesTaxRate: 6.625, domesticSecurityFeeRate: 5, domesticSecurityFeeMaxDays: 28, domesticSecurityFeeMode: 'review' } });
    assert(managerTaxSettings.status === 403, 'Manager must not change owner tax settings.');
    const taxSettings = await request(server, 'POST', '/api/accounting/tax-settings', { cookie: ownerCookie, json: { state: 'NJ', salesTaxRate: 6.625, pricesIncludeSalesTax: false, domesticSecurityFeeRate: 5, domesticSecurityFeeMaxDays: 28, domesticSecurityFeeMode: 'review' } });
    assert(taxSettings.status === 200 && taxSettings.json && taxSettings.json.settings && Math.abs(taxSettings.json.settings.salesTaxRate - 0.06625) < 0.0000001, 'Owner tax settings should normalize the NJ percent rate: ' + taxSettings.status + ' ' + taxSettings.text.slice(0, 300));
    const managerClassification = await request(server, 'POST', '/api/accounting/tax-classification', { cookie: managerCookie, json: { contractId: 'route-tax-contract', domesticSecurityFeeApplies: true } });
    assert(managerClassification.status === 403, 'Manager must not choose an agreement tax position.');
    const classification = await request(server, 'POST', '/api/accounting/tax-classification', { cookie: ownerCookie, json: { contractId: 'route-tax-contract', domesticSecurityFeeApplies: true, notes: 'Owner test classification.' } });
    assert(classification.status === 200 && classification.json.contract.domesticSecurityFeeApplies === true, 'Owner agreement classification should persist with an audit record.');
    const starReview = await request(server, 'POST', '/api/accounting/star-review', { cookie: ownerCookie, json: { year: '2026', month: '2026-01' } });
    assert(starReview.status === 200 && starReview.json.review && starReview.json.review.summary && Array.isArray(starReview.json.review.nextSteps), 'Star should return a usable aggregate accounting review without requiring a provider connection.');
    const managerStarReview = await request(server, 'POST', '/api/accounting/star-review', { cookie: managerCookie, json: { year: '2026' } });
    assert(managerStarReview.status === 403, 'Manager must not run owner tax analysis.');

    const managerAdjustment = await request(server, 'POST', '/api/accounting/adjustments', {
      cookie: managerCookie, json: { date: '2026-01-15', direction: 'debit', amount: 125, category: 'Insurance expense', notes: 'Should be owner only.' }
    });
    assert(managerAdjustment.status === 403, 'Manager must not create owner accounting adjustments.');
    const adjustment = await request(server, 'POST', '/api/accounting/adjustments', {
      cookie: ownerCookie,
      json: { date: '2026-01-15', direction: 'debit', amount: 125.50, category: 'Insurance expense', method: 'Business card', reference: 'ROUTE-RECEIPT-1', notes: 'Route-level accounting verification.' }
    });
    assert(adjustment.status === 201 && adjustment.json.ledgerEntry.sourceKey, 'Owner accounting adjustment did not create a source-linked ledger entry.');
    const sourceKey = adjustment.json.ledgerEntry.sourceKey;
    const reconciled = await request(server, 'POST', '/api/accounting/reconcile', {
      cookie: ownerCookie, json: { sourceKey, status: 'reconciled', notes: 'Matched business-card receipt ROUTE-RECEIPT-1.' }
    });
    assert(reconciled.status === 200 && /reconciled/i.test(reconciled.json.entry.reconciliationStatus), 'Accounting reconciliation did not persist.');
    const closed = await request(server, 'POST', '/api/accounting/periods/close', {
      cookie: ownerCookie, json: { month: '2026-01', confirmed: true, notes: 'Direct route test close.' }
    });
    assert(closed.status === 201 && /^[a-f0-9]{64}$/i.test(closed.json.period.sourceHash), 'Month close did not create a tamper-evident source hash.');
    const duplicateClose = await request(server, 'POST', '/api/accounting/periods/close', {
      cookie: ownerCookie, json: { month: '2026-01', confirmed: true }
    });
    assert(duplicateClose.status === 200 && duplicateClose.json.duplicate, 'Month close must be idempotent.');
    const quickBooksCsv = await request(server, 'GET', '/api/accounting/quickbooks.csv', { cookie: managerCookie });
    assert(quickBooksCsv.status === 200 && quickBooksCsv.text.includes('Journal No.') && quickBooksCsv.text.includes('ROUTE-RECEIPT-1'), 'QuickBooks journal export is missing the reconciled source entry.');
    const taxCsv = await request(server, 'GET', '/api/accounting/tax-summary.csv?year=2026', { cookie: managerCookie });
    assert(taxCsv.status === 200 && taxCsv.text.includes('Monthly') && taxCsv.text.includes('Quarterly') && taxCsv.text.includes('Yearly') && taxCsv.text.includes('DSF confirmed'), 'Tax export should include monthly, quarterly, yearly, sales-tax, and Domestic Security Fee preparation rows.');

    console.log('Risk/accounting route checks passed: role isolation, manual insurance, consent, signed webhooks, native tax settings, DSF classification, Star review, reconciliation, month close, and tax-ready exports.');
  } finally {
    try { server.close(); } catch (_) {}
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
