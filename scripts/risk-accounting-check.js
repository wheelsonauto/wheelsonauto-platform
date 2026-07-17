const assert = require('assert');
const crypto = require('crypto');
const risk = require('../risk-provider-adapter');
const engine = require('../integration-engine');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

(async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/candidates')) return response({ id: 'candidate-1' });
    if (url.endsWith('/invitations')) return response({ id: 'invitation-1', report_id: null, invitation_url: 'https://apply.checkr.com/invite/test', status: 'pending', expires_at: '2026-07-24' });
    throw new Error('Unexpected provider request ' + url);
  };
  const checkrCase = {
    id: 'verify-driver-1',
    type: 'driver_record',
    customer: 'Test Driver',
    email: 'driver@example.com'
  };
  const invitation = await risk.createCheckrInvitation(checkrCase, {
    apiKey: 'checkr-secret',
    backgroundPackage: 'background-package',
    mvrPackage: 'mvr-package',
    useCaseConfirmed: true,
    state: 'NJ',
    city: 'Blackwood'
  }, fetchMock);
  assert.equal(invitation.provider, 'Checkr');
  assert.equal(invitation.providerInvitationId, 'invitation-1');
  assert.equal(invitation.customerActionUrl, 'https://apply.checkr.com/invite/test');
  assert.equal(calls.length, 2, 'Checkr should create one candidate and one hosted invitation.');
  assert.match(calls[1].options.body, /package=mvr-package/);
  assert(!JSON.stringify(invitation).includes('driver@example.com'), 'Provider return records must not duplicate customer PII.');

  await assert.rejects(() => risk.createCheckrInvitation(checkrCase, {
    apiKey: 'checkr-secret', backgroundPackage: 'bg', mvrPackage: 'mvr', useCaseConfirmed: false
  }, fetchMock), /permissible-purpose/i, 'A regulated check must remain blocked until the use case is confirmed.');

  const checkrPayload = JSON.stringify({ id: 'event-1', type: 'report.completed', data: { object: { id: 'report-1', object: 'report', candidate_id: 'candidate-1', status: 'complete', result: 'consider', tags: ['wheelsonauto', 'verify-driver-1'] } } });
  const checkrSignature = crypto.createHmac('sha256', 'checkr-secret').update(checkrPayload).digest('hex');
  assert.equal(risk.verifyCheckrWebhook(checkrPayload, checkrSignature, 'checkr-secret'), true);
  const parsedCheckr = risk.parseCheckrWebhook(JSON.parse(checkrPayload));
  assert.equal(parsedCheckr.caseId, 'verify-driver-1');
  assert.equal(parsedCheckr.providerStatus, 'consider');

  const canopyUrl = risk.buildCanopyConnectUrl({ id: 'verify-insurance-1', vehicleId: 'vehicle-1', organizationId: 'org-1', customer: 'Private Customer' }, { publicAlias: 'wheelsonauto' });
  assert.match(canopyUrl, /^https:\/\/app\.usecanopy\.com\/c\/wheelsonauto/);
  assert.match(canopyUrl, /ccmeta-verification_case_id=verify-insurance-1/);
  assert(!canopyUrl.includes('Private'), 'Canopy metadata links must use internal IDs instead of customer PII.');

  const timestamp = Math.floor(Date.now() / 1000);
  const canopyPayload = JSON.stringify({ event_type: 'MONITORING_RECONNECT', pull_id: 'pull-1', meta_data: { verification_case_id: 'verify-insurance-1' }, is_monitored: true, monitoring: { monitoring_id: 'monitor-1' }, data: { reconnect_url: 'https://app.usecanopy.com/reconnect/secure' } });
  const canopySignature = crypto.createHmac('sha256', 'canopy-secret').update(timestamp + '.' + canopyPayload).digest('hex');
  assert.equal(risk.verifyCanopyWebhook(canopyPayload, 't=' + timestamp + ',s=' + canopySignature, 'canopy-secret'), true);
  const parsedCanopy = risk.parseCanopyWebhook(JSON.parse(canopyPayload));
  assert.equal(parsedCanopy.caseId, 'verify-insurance-1');
  assert.equal(parsedCanopy.providerStatus, 'reconnect required');
  assert.equal(parsedCanopy.isMonitored, true);

  const policies = risk.sanitizeCanopyPull({ policies: [{ carrier_name: 'Example Insurance', policy_number: 'PRIVATE-POLICY-7788', policy_status: 'Active', effective_date: '2026-01-01', expiration_date: '2027-01-01' }] });
  assert.equal(policies[0].policyNumberLast4, '7788');
  assert(!JSON.stringify(policies).includes('PRIVATE-POLICY'), 'Only policy last-four may leave the provider adapter.');
  assert.equal(risk.verificationMonitorState({ status: 'Verified', expiresAt: '2026-07-20' }, '2026-07-17').level, 'urgent');
  assert.equal(risk.verificationMonitorState({ status: 'reconnect required' }, '2026-07-17').level, 'critical');

  const data = {
    customers: [{ id: 'customer-1', name: 'Test Driver', email: 'driver@example.com', vehicleId: 'vehicle-1' }],
    contracts: [], recurringPayments: [],
    vehicles: [{ id: 'vehicle-1', year: 2020, make: 'Ford', model: 'Escape', vin: 'VIN-ACCOUNTING-1', plate: 'TAG-1', currentCustomer: 'Test Driver' }],
    payments: [{ id: 'payment-1', customer: 'Test Driver', vehicleId: 'vehicle-1', amount: 229, status: 'Paid', date: '2026-07-17', method: 'Stripe card', providerPaymentId: 'stripe-payment-1' }],
    refundRequests: [], maintenance: [], claims: [],
    accountingAdjustments: [{ id: 'adjustment-1', direction: 'debit', amount: 65, category: 'Insurance expense', date: '2026-07-17', notes: 'Monthly policy charge', reference: 'receipt-1', status: 'Recorded' }]
  };
  const driverRecord = engine.verificationCase(data, { type: 'driver_record', customer: 'Test Driver', provider: 'Checkr' }, { name: 'Manager' });
  assert.equal(driverRecord.created, true);
  assert.equal(driverRecord.record.type, 'driver_record');
  engine.applyVerificationEvent(driverRecord.record, { providerStatus: 'consider', providerReportId: 'report-1' });
  assert.equal(driverRecord.record.status, 'Needs staff review', 'Checkr Consider must not auto-reject a customer.');

  let ledger = engine.buildAccountingLedger(data, []);
  assert.equal(ledger.length, 2);
  assert(ledger.some(row => row.sourceKey === 'adjustment:adjustment-1' && row.direction === 'debit'));
  const paymentEntry = ledger.find(row => row.sourceKey === 'payment:payment-1');
  engine.reconcileAccountingEntry(paymentEntry, { status: 'reconciled', notes: 'Matched Stripe deposit.' }, { name: 'Owner' });
  ledger = engine.buildAccountingLedger(data, ledger);
  assert.equal(ledger.find(row => row.sourceKey === 'payment:payment-1').reconciliationStatus, 'Reconciled', 'Ledger rebuilds must preserve reconciliation evidence.');
  engine.reconcileAccountingEntry(ledger.find(row => row.sourceKey === 'adjustment:adjustment-1'), { status: 'reconciled', notes: 'Matched receipt.' }, { name: 'Owner' });
  const summary = engine.accountingLedgerSummary(ledger, { month: '2026-07' });
  assert.equal(summary.credits, 229);
  assert.equal(summary.debits, 65);
  assert.equal(summary.net, 164);
  assert.equal(summary.readyToClose, true);
  const period = engine.accountingPeriodSnapshot(ledger, '2026-07', { name: 'Owner' });
  assert.equal(period.status, 'Closed');
  assert.equal(period.sourceHash.length, 64);
  const journal = engine.buildQuickBooksJournalRows(ledger);
  const journalDebit = journal.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const journalCredit = journal.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  assert.equal(journalDebit, journalCredit, 'QuickBooks journal export must stay balanced.');

  console.log('Risk/accounting checks passed: hosted consent, signed webhooks, masked policy data, monitoring, reconciliation, month close, and balanced export.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
