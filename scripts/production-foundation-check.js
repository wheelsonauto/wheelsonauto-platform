'use strict';

const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stateRepository = require('../state-repository');
const secureDocumentStore = require('../secure-document-store');
const encryptedStateBackup = require('../encrypted-state-backup');
const stripeMigration = require('../stripe-migration');
const {
  assignmentConflictPreflightClassification,
  cardSetupPlanReview,
  controlledStripePilotEvidence,
  controlledStripePilotSelection,
  controlledStripePilotMoneyActionReview,
  lockControlledStripePilotCandidate,
  repairControlledStripeTestPilotLock
} = require('../server');
const { runCliArgumentChecks } = require('./cli-argument-check');

async function verifyGracefulShutdown(root, dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      TMPDIR: process.env.TMPDIR || '',
      LANG: process.env.LANG || 'en_US.UTF-8',
      DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: '0',
      WOA_DATA_BACKEND: 'json',
      WOA_PRODUCTION_HARDENING_REQUIRED: '0',
      WOA_AUTO_SYNC_MS: '3600000',
      WOA_AUTOPAY_MS: '3600000',
      WOA_AUTO_SYNC_STARTUP_DELAY_MS: '3600000',
      WOA_MESSAGING_ENABLED: '0',
      WOA_EMAIL_ENABLED: '0',
      WOA_STAR_AI_ENABLED: '0',
      WOA_TRACKER_PROVIDER: 'none',
      PUBLIC_BASE_URL: 'http://127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const capture = chunk => {
    output += String(chunk || '');
    if (/WheelsonAuto platform running/i.test(output)) startedResolve(true);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const startupTimer = setTimeout(() => startedResolve(false), 10000);
  const didStart = await started;
  clearTimeout(startupTimer);
  if (!didStart) {
    child.kill('SIGKILL');
    await exited;
    throw new Error('The isolated graceful-shutdown server did not start: ' + output.slice(-2000));
  }
  child.kill('SIGTERM');
  const exitResult = await Promise.race([
    exited,
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 10000))
  ]);
  if (exitResult.timedOut) {
    child.kill('SIGKILL');
    await exited;
    throw new Error('The isolated server did not finish graceful shutdown within 10 seconds: ' + output.slice(-2000));
  }
  assert.strictEqual(exitResult.code, 0, 'The isolated production process must exit cleanly after SIGTERM. Output: ' + output.slice(-2000));
  assert.match(output, /draining active requests and state writes/i, 'The production process must enter its explicit drain path before exiting.');
}

async function main() {
  runCliArgumentChecks();
  const pilotSelection = controlledStripePilotSelection({
    applications: [
      { id: 'app-pilot-ready', name: 'Pilot Customer', email: 'pilot@example.com', onlineVehicleId: 'online-pilot-ready', vehicle: '2020 Pilot Ready', pricingSnapshot: { weeklyPayment: 229, downPayment: 485 }, status: 'New', submittedAt: '2026-07-21T12:00:00.000Z' },
      { id: 'app-pilot-placeholder', name: 'Placeholder Customer', email: 'placeholder@example.com', onlineVehicleId: 'online-pilot-placeholder', vehicle: 'Online vehicle', pricingSnapshot: { weeklyPayment: 1, downPayment: 1 }, status: 'New', submittedAt: '2026-07-21T11:30:00.000Z' },
      { id: 'app-pilot-blocked', name: 'Blocked Customer', email: 'blocked@example.com', onlineVehicleId: 'online-pilot-blocked', vehicle: '2021 Pilot Blocked', pricingSnapshot: {}, status: 'New', submittedAt: '2026-07-21T11:00:00.000Z' }
    ],
    onlineVehicles: [
      { id: 'online-pilot-ready', platformVehicleId: 'veh-pilot-ready', title: '2020 Pilot Ready', vin: '1HGCM82633A123456', plate: 'PIL-001', weeklyPayment: 229, downPayment: 485, published: true, availability: 'Available' },
      { id: 'online-pilot-placeholder', platformVehicleId: 'veh-pilot-placeholder', title: 'Online vehicle', vin: 'test', plate: 'test', weeklyPayment: 1, downPayment: 1, published: true, availability: 'Available' },
      { id: 'online-pilot-blocked', platformVehicleId: 'veh-pilot-blocked', title: '2021 Pilot Blocked', published: true, availability: 'Available' }
    ],
    vehicles: [
      { id: 'veh-pilot-ready', vin: '1HGCM82633A123456', plate: 'PIL-001', status: 'Ready' },
      { id: 'veh-pilot-placeholder', vin: 'test', plate: 'test', status: 'Ready' },
      { id: 'veh-pilot-blocked', status: 'Ready' }
    ],
    onboardingSessions: []
  });
  assert.strictEqual(pilotSelection.eligibleCount, 2, 'The owner pilot chooser must expose exact real files plus a tightly capped legacy test listing with multiple explicit test identifiers.');
  assert.strictEqual(pilotSelection.candidates[0].applicationId, 'app-pilot-ready', 'Eligible pilot files must sort ahead of review-only files.');
  assert.deepStrictEqual(pilotSelection.candidates[0].blockers, [], 'An exact available applicant and vehicle must open without a false blocker.');
  assert.strictEqual(pilotSelection.candidates[0].paymentProvider, 'clover', 'The pilot chooser must expose the actual configured onboarding payment provider instead of guessing in the browser.');
  assert.strictEqual(pilotSelection.candidates[0].identityProvider, 'manual', 'The pilot chooser must expose the actual configured identity provider instead of guessing in the browser.');
  assert.strictEqual(pilotSelection.candidates[0].nextActions[0].owner, 'System', 'A legacy pilot candidate without its automatic setup must explain the responsible repair path without mutating the file.');
  assert.match(pilotSelection.candidates[0].nextActions[0].text, /without sending a charge/i, 'Automatic setup repair must state that it does not send a charge.');
  const placeholderPilot = pilotSelection.candidates.find(row => row.applicationId === 'app-pilot-placeholder');
  assert(placeholderPilot && placeholderPilot.eligible === true && placeholderPilot.controlledTest === true, 'A $1 legacy listing with multiple explicit test identifiers must be isolated as a controlled pilot test instead of being confused with a real vehicle.');
  assert(pilotSelection.candidates.find(row => row.applicationId === 'app-pilot-blocked').blockers.some(reason => /VIN/.test(reason)), 'A pilot file without vehicle identity must fail closed instead of guessing.');
  const inProgressPilotSelection = controlledStripePilotSelection({
    applications: [{ id: 'app-pilot-progress', name: 'Progress Customer', email: 'progress@example.com', address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: '66', driverLicenseExpires: '2035-01-01', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: '2020-01-01', requestedPickupTime: '11:00 AM', onlineVehicleId: 'online-pilot-progress', pricingSnapshot: { weeklyPayment: 229, downPayment: 485 }, status: 'Onboarding', submittedAt: '2026-07-21T13:00:00.000Z' }],
    onlineVehicles: [{ id: 'online-pilot-progress', platformVehicleId: 'veh-pilot-progress', title: '2019 Pilot Progress', vin: '2C3CDXBG5KH123456', plate: 'PIL-002', weeklyPayment: 229, downPayment: 485, published: false, availability: 'Held', heldApplicationId: 'app-pilot-progress' }],
    vehicles: [{ id: 'veh-pilot-progress', vin: '2C3CDXBG5KH123456', plate: 'PIL-002', status: 'Held for onboarding' }],
    onboardingSessions: [{ id: 'onboard-pilot-progress', applicationId: 'app-pilot-progress', onlineVehicleId: 'online-pilot-progress', status: 'Open', paymentProvider: 'stripe', identityProvider: 'stripe' }]
  });
  const inProgressActions = inProgressPilotSelection.candidates[0].nextActions.map(action => action.text).join(' ');
  assert.match(inProgressActions, /complete driver license number/i, 'An in-progress pilot file must identify the incomplete license without showing its raw value.');
  assert.match(inProgressActions, /pickup date/i, 'An in-progress pilot file must identify a stale pickup request before the customer reaches a server rejection.');
  assert(!inProgressActions.includes('66'), 'Pilot guidance must never echo the raw driver-license value.');
  const pilotEvidenceSelectionState = {
    integrations: { stripe: {} },
    applications: [
      { id: 'app-removed-newer', name: 'Removed Applicant', email: 'removed@example.com', onlineVehicleId: 'online-shared-test', pricingSnapshot: { weeklyPayment: 1, downPayment: 1 }, status: 'Removed - owner test reset', submittedAt: '2026-07-23T15:00:00.000Z' },
      { id: 'app-active-pilot', name: 'Active Pilot', email: 'active@example.com', onlineVehicleId: 'online-shared-test', pricingSnapshot: { weeklyPayment: 1, downPayment: 1 }, status: 'Payment received - completing onboarding', submittedAt: '2026-07-23T14:00:00.000Z' }
    ],
    onlineVehicles: [{ id: 'online-shared-test', platformVehicleId: 'veh-shared-test', title: 'Online vehicle', make: 'test', model: 'test', vin: 'test', plate: 'test', weeklyPayment: 1, downPayment: 1, published: false, availability: 'Paid - pending pickup' }],
    vehicles: [{ id: 'veh-shared-test', vin: 'test', plate: 'test', status: 'Paid - pending pickup' }],
    onboardingSessions: [
      { id: 'onboard-removed-newer', applicationId: 'app-removed-newer', onlineVehicleId: 'online-shared-test', status: 'Open', paymentProvider: 'stripe', identityProvider: 'stripe', updatedAt: '2026-07-23T16:00:00.000Z' },
      { id: 'onboard-active-pilot', applicationId: 'app-active-pilot', onlineVehicleId: 'online-shared-test', status: 'Pickup reserved - insurance verification required', paymentProvider: 'stripe', identityProvider: 'stripe', updatedAt: '2026-07-23T15:30:00.000Z' }
    ]
  };
  const activePilotEvidence = controlledStripePilotEvidence(pilotEvidenceSelectionState, { liveRequired: true });
  assert.strictEqual(activePilotEvidence.candidate.applicationId, 'app-active-pilot', 'A newer removed application must not replace the eligible active Stripe pilot on the production preflight.');
  const pilotMoneyState = {
    integrations: { stripe: {} },
    applications: [{ id: 'app-pilot-money', name: 'Pilot Money Customer', email: 'pilot-money@example.com', onlineVehicleId: 'online-pilot-money', vehicle: '2020 Pilot Money', pricingSnapshot: { weeklyPayment: 229, downPayment: 485 }, status: 'Onboarding', submittedAt: '2026-07-21T14:00:00.000Z' }],
    onlineVehicles: [{ id: 'online-pilot-money', platformVehicleId: 'veh-pilot-money', title: '2020 Pilot Money', vin: '1N4AL3AP8JC123456', plate: 'PIL-003', weeklyPayment: 229, downPayment: 485, published: false, availability: 'Held', heldApplicationId: 'app-pilot-money' }],
    vehicles: [{ id: 'veh-pilot-money', vin: '1N4AL3AP8JC123456', plate: 'PIL-003', status: 'Held for onboarding' }],
    onboardingSessions: [{ id: 'onboard-pilot-money', applicationId: 'app-pilot-money', onlineVehicleId: 'online-pilot-money', status: 'Approved - Stripe Identity ready', paymentProvider: 'stripe', identityProvider: 'stripe' }]
  };
  lockControlledStripePilotCandidate(pilotMoneyState, pilotMoneyState.applications[0], pilotMoneyState.onboardingSessions[0], { name: 'Owner' });
  const pilotDepositReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'app-pilot-money', onboardingSessionId: 'onboard-pilot-money', paymentType: 'Nonrefundable down payment' }, { isolatedTestMode: false, pilotApproved: false });
  assert.strictEqual(pilotDepositReview.allowed, true, 'Final hardening may unlock only the exact owner-selected pilot deposit before pilot approval.');
  const unrelatedPaymentReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'another-application', onboardingSessionId: 'another-session', paymentType: 'First weekly payment' }, { isolatedTestMode: false, pilotApproved: false });
  assert.strictEqual(unrelatedPaymentReview.allowed, false, 'Final hardening must not unlock another customer payment before the first pilot is approved.');
  const ordinaryPilotChargeReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'app-pilot-money', onboardingSessionId: 'onboard-pilot-money', paymentType: 'Weekly payment' }, { isolatedTestMode: false, pilotApproved: false });
  assert.strictEqual(ordinaryPilotChargeReview.allowed, false, 'The selected pilot lock must allow only its separate deposit and first-week transactions before approval.');
  const approvedGeneralMoneyReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'another-application', onboardingSessionId: 'another-session', paymentType: 'Weekly payment' }, { isolatedTestMode: false, pilotApproved: true });
  assert.strictEqual(approvedGeneralMoneyReview.allowed, true, 'Owner approval of the completed pilot may release later Stripe money actions while the cutover gate remains separate.');
  pilotMoneyState.onboardingSessions[0].status = 'Cancelled';
  const cancelledPilotReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'app-pilot-money', onboardingSessionId: 'onboard-pilot-money', paymentType: 'Nonrefundable down payment' }, { isolatedTestMode: false, pilotApproved: false });
  assert.strictEqual(cancelledPilotReview.allowed, false, 'Cancelling the selected pilot must immediately revoke its pre-approval money scope.');
  const cancelledPilotRefundReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'app-pilot-money', onboardingSessionId: 'onboard-pilot-money', paymentType: 'Nonrefundable down payment' }, { isolatedTestMode: false, pilotApproved: false, allowPilotEvidenceAction: true });
  assert.strictEqual(cancelledPilotRefundReview.allowed, true, 'Cancelling the selected pilot must never trap its already-paid deposit or block an exact refund/dispute unwind.');
  const unrelatedCancelledRefundReview = controlledStripePilotMoneyActionReview(pilotMoneyState, { applicationId: 'another-application', onboardingSessionId: 'another-session', paymentType: 'Nonrefundable down payment' }, { isolatedTestMode: false, pilotApproved: false, allowPilotEvidenceAction: true });
  assert.strictEqual(unrelatedCancelledRefundReview.allowed, false, 'A cancelled pilot refund exception must remain bound to the exact locked application and onboarding file.');
  const testPilotReplacementState = {
    integrations: { stripe: {} },
    applications: [
      { id: 'app-old-unpaid-pilot', name: 'Old Pilot', email: 'old@example.com', onlineVehicleId: 'online-old-pilot', pricingSnapshot: { weeklyPayment: 229, downPayment: 485 }, status: 'Onboarding', submittedAt: '2026-07-21T12:00:00.000Z' },
      { id: 'app-current-dollar-test', name: 'Current Test', email: 'current@example.com', onlineVehicleId: 'online-dollar-test', pricingSnapshot: { weeklyPayment: 1, downPayment: 1 }, status: 'Screening approved - Stripe Identity ready', submittedAt: '2026-07-23T12:00:00.000Z' }
    ],
    onlineVehicles: [
      { id: 'online-old-pilot', platformVehicleId: 'veh-old-pilot', title: '2019 Old Pilot', vin: '2C3CDXBG5KH123456', plate: 'OLD-001', weeklyPayment: 229, downPayment: 485, published: false, availability: 'Available' },
      { id: 'online-dollar-test', platformVehicleId: 'veh-dollar-test', title: 'Online vehicle', make: 'test', model: 'test', vin: 'test', plate: 'test', weeklyPayment: 1, downPayment: 1, published: true, availability: 'Available' }
    ],
    vehicles: [
      { id: 'veh-old-pilot', vin: '2C3CDXBG5KH123456', plate: 'OLD-001', status: 'Ready' },
      { id: 'veh-dollar-test', vin: 'test', plate: 'test', status: 'Ready' }
    ],
    onboardingSessions: [
      { id: 'onboard-old-unpaid-pilot', applicationId: 'app-old-unpaid-pilot', onlineVehicleId: 'online-old-pilot', status: 'Card linked', paymentProvider: 'stripe', identityProvider: 'stripe' },
      { id: 'onboard-current-dollar-test', applicationId: 'app-current-dollar-test', onlineVehicleId: 'online-dollar-test', status: 'Screening approved - Stripe Identity ready', finalReviewStatus: 'Approved', identityVerificationStatus: 'verified', identityLegalNameMatch: true, paymentProvider: 'stripe', identityProvider: 'stripe' }
    ],
    recurringPayments: [{ id: 'rec-current-dollar-test', applicationId: 'app-current-dollar-test', onboardingSessionId: 'onboard-current-dollar-test', paymentProvider: 'stripe', status: 'Active' }],
    paymentRequests: [],
    payments: [],
    auditLog: []
  };
  lockControlledStripePilotCandidate(testPilotReplacementState, testPilotReplacementState.applications[0], testPilotReplacementState.onboardingSessions[0], { name: 'Owner' });
  const repairedPilot = repairControlledStripeTestPilotLock(testPilotReplacementState, testPilotReplacementState.applications[1], testPilotReplacementState.onboardingSessions[1], testPilotReplacementState.onlineVehicles[1], { name: 'System' });
  assert.strictEqual(repairedPilot.changed, true, 'An approved capped test must repair an older unpaid pilot lock before its deposit checkout opens.');
  assert.strictEqual(testPilotReplacementState.integrations.stripe.controlledPilotCandidateOnboardingSessionId, 'onboard-current-dollar-test', 'The repaired lock must stay tied to the exact current onboarding file.');
  assert.strictEqual(testPilotReplacementState.recurringPayments[0].controlledStripePilotTest, true, 'Controlled test payment data must stay excluded from business revenue.');
  const paidOldPilotState = JSON.parse(JSON.stringify(testPilotReplacementState));
  Object.assign(paidOldPilotState.integrations.stripe, { controlledPilotCandidateApplicationId: 'app-old-unpaid-pilot', controlledPilotCandidateOnboardingSessionId: 'onboard-old-unpaid-pilot' });
  paidOldPilotState.paymentRequests.push({ id: 'paid-old-deposit', applicationId: 'app-old-unpaid-pilot', onboardingSessionId: 'onboard-old-unpaid-pilot', paymentProvider: 'stripe', paymentType: 'Nonrefundable down payment', status: 'Paid' });
  assert.throws(
    () => repairControlledStripeTestPilotLock(paidOldPilotState, paidOldPilotState.applications[1], paidOldPilotState.onboardingSessions[1], paidOldPilotState.onlineVehicles[1], { name: 'System' }),
    error => error && error.code === 'stripe_pilot_candidate_already_locked',
    'A paid pilot lock must never be displaced by the automatic test repair.'
  );
  const duplicateHoldState = {
    onboardingSessions: [
      { id: 'onboarding-one', applicationId: 'application-one', onlineVehicleId: 'online-shared', status: 'Identity pending' },
      { id: 'onboarding-two', applicationId: 'application-two', onlineVehicleId: 'online-shared', status: 'Card setup pending' }
    ]
  };
  assert.strictEqual(stateRepository.activeOnboardingVehicleHoldConflicts(duplicateHoldState).length, 0, 'Multiple unpaid applicants must be allowed to onboard for the same still-public vehicle.');
  assert.doesNotThrow(() => stateRepository.criticalResourceIndexRows(duplicateHoldState), 'Multiple unpaid applicants must not be rejected as an ambiguous database write.');
  const conflictingPaidClaimsState = {
    ...duplicateHoldState,
    applications: [
      { id: 'application-one', onlineVehicleId: 'online-shared' },
      { id: 'application-two', onlineVehicleId: 'online-shared' }
    ],
    paymentRequests: [
      { id: 'payment-one', applicationId: 'application-one', onboardingSessionId: 'onboarding-one', onlineVehicleId: 'online-shared', status: 'Paid' },
      { id: 'payment-two', applicationId: 'application-two', onboardingSessionId: 'onboarding-two', onlineVehicleId: 'online-shared', status: 'Paid - vehicle conflict / refund required' }
    ]
  };
  assert.strictEqual(stateRepository.activeOnboardingVehicleHoldConflicts(conflictingPaidClaimsState).length, 1, 'Two different paid applications must still be detected as conflicting claims on one vehicle.');
  assert.throws(
    () => stateRepository.criticalResourceIndexRows(conflictingPaidClaimsState),
    error => error && error.code === 'woa_onboarding_vehicle_hold_conflict' && error.vehicleId === 'online-shared',
    'The transactional PostgreSQL write must reject verified payment claims from two different applications for the same vehicle.'
  );
  assert.doesNotThrow(() => stateRepository.criticalResourceIndexRows({
    ...duplicateHoldState,
    paymentRequests: [
      { id: 'deposit-one', applicationId: 'application-one', onboardingSessionId: 'onboarding-one', onlineVehicleId: 'online-shared', status: 'Paid' },
      { id: 'weekly-one', applicationId: 'application-one', onboardingSessionId: 'onboarding-one', onlineVehicleId: 'online-shared', status: 'Paid' }
    ]
  }), 'Separate paid transactions for the same application must remain one legitimate vehicle claim.');
  const schemaContractRows = [
    ...stateRepository.REQUIRED_SCHEMA_CONTRACT.constraints.map(([tableName, type, definition]) => ({
      kind: 'constraint',
      table_name: tableName,
      type,
      definition
    })),
    ...stateRepository.REQUIRED_SCHEMA_CONTRACT.indexes.map(([tableName, name, definitionParts]) => ({
      kind: 'index',
      table_name: tableName,
      name,
      definition: 'CREATE UNIQUE INDEX ' + name + ' ON ' + tableName + ' ' + definitionParts.slice(1).join(' ')
    }))
  ];
  const completeSchemaContract = stateRepository.schemaContractEvidence(schemaContractRows, stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS);
  assert.strictEqual(completeSchemaContract.ready, true, 'The exact production PostgreSQL schema contract fixture must be accepted.');
  const driftedSchemaContract = stateRepository.schemaContractEvidence(schemaContractRows.slice(0, -1), stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS.slice(0, -1));
  assert.strictEqual(driftedSchemaContract.ready, false, 'Missing PostgreSQL migration and safety-index evidence must fail closed.');
  assert.deepStrictEqual(driftedSchemaContract.missingMigrations, [stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS.at(-1)], 'Schema evidence must name the exact missing migration.');
  assert.deepStrictEqual(driftedSchemaContract.missingIndexes, [{ tableName: 'woa_job_errors', name: 'woa_job_errors_open_fingerprint_unique' }], 'Schema evidence must name the exact missing safety index.');
  const staleReviewClassification = assignmentConflictPreflightClassification({
    vehicles: [{ id: 'veh-review-only', year: 2025, make: 'Review', model: 'Only', vin: 'REVIEWONLYVIN', status: 'Rented', currentCustomer: 'Current Customer', assignmentConflict: 'Imported Name / Current Customer' }],
    recurringPayments: [{ id: 'rec-review-only', customer: 'Current Customer', vehicleId: 'veh-review-only', status: 'Active' }]
  });
  assert.strictEqual(staleReviewClassification.all.length, 1, 'A saved assignment warning must remain visible for owner review.');
  assert.strictEqual(staleReviewClassification.blocking.length, 0, 'A saved warning without two active assignment records must not falsely block PostgreSQL or Stripe launch.');
  assert.strictEqual(staleReviewClassification.review.length, 1, 'A non-transactional assignment warning must stay in the explicit owner-review collection.');

  const activeConflictClassification = assignmentConflictPreflightClassification({
    vehicles: [{ id: 'veh-active-conflict', year: 2025, make: 'Active', model: 'Conflict', vin: 'ACTIVECONFLICTVIN', status: 'Rented', assignmentConflict: 'First Customer / Second Customer' }],
    recurringPayments: [
      { id: 'rec-active-conflict-one', customer: 'First Customer', vehicleId: 'veh-active-conflict', status: 'Active' },
      { id: 'rec-active-conflict-two', customer: 'Second Customer', vehicleId: 'veh-active-conflict', status: 'Active' }
    ]
  });
  assert.strictEqual(activeConflictClassification.blocking.length, 1, 'Two active customer claims for one vehicle must remain a launch-blocking transactional conflict.');
  assert.strictEqual(activeConflictClassification.review.length, 0, 'A transactional assignment conflict must not be downgraded to a review-only warning.');

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-production-foundation-'));
  try {
    const seedFile = path.join(temp, 'seed.json');
    const dataFile = path.join(temp, 'data.json');
    await fs.writeFile(seedFile, JSON.stringify({ vehicles: [], customers: [], payments: [], documents: [], eSignatures: [] }), 'utf8');

    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const fatalProcessMonitorSource = await fs.readFile(path.resolve(__dirname, '..', 'fatal-process-monitor.js'), 'utf8');
    const dependencyVulnerabilityCheckSource = await fs.readFile(path.resolve(__dirname, 'dependency-vulnerability-check.js'), 'utf8');
    const packageSource = await fs.readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8');
    const repairDataSource = await fs.readFile(path.resolve(__dirname, 'repair-data.js'), 'utf8');
    const repairDataCheckSource = await fs.readFile(path.resolve(__dirname, 'repair-data-check.js'), 'utf8');
    const onboardingSource = await fs.readFile(path.resolve(__dirname, '..', 'onboarding-service.js'), 'utf8');
    const stateRepositorySource = await fs.readFile(path.resolve(__dirname, '..', 'state-repository.js'), 'utf8');
    const stateMigrationLockSource = await fs.readFile(path.resolve(__dirname, '..', 'state-migration-lock.js'), 'utf8');
    const postgresSourceRepairSource = await fs.readFile(path.resolve(__dirname, 'prepare-postgres-migration-source.js'), 'utf8');
    const postgresSourceRepairCheckSource = await fs.readFile(path.resolve(__dirname, 'postgres-source-repair-check.js'), 'utf8');
    const postgresMigrationSource = await fs.readFile(path.resolve(__dirname, '..', 'postgres-migration-source.js'), 'utf8');
    const migrationMaintenanceLeaseSource = await fs.readFile(path.resolve(__dirname, '..', 'migration-maintenance-lease.js'), 'utf8');
    const postgresPreflightSource = await fs.readFile(path.resolve(__dirname, 'postgres-preflight.js'), 'utf8');
    const postgresImporterSource = await fs.readFile(path.resolve(__dirname, 'migrate-json-to-postgres.js'), 'utf8');
    const postgresVerifierSource = await fs.readFile(path.resolve(__dirname, 'verify-json-to-postgres.js'), 'utf8');
    const postgresLockRecoverySource = await fs.readFile(path.resolve(__dirname, 'recover-postgres-migration-lock.js'), 'utf8');
    const postgresRuntimeCheckSource = await fs.readFile(path.resolve(__dirname, 'postgres-runtime-check.js'), 'utf8');
    const objectStorageRuntimeCheckSource = await fs.readFile(path.resolve(__dirname, 'object-storage-runtime-check.js'), 'utf8');
    const secureDocumentStoreSource = await fs.readFile(path.resolve(__dirname, '..', 'secure-document-store.js'), 'utf8');
    const privateDocumentMigrationSource = await fs.readFile(path.resolve(__dirname, 'migrate-private-documents.js'), 'utf8');
    const encryptedBackupSource = await fs.readFile(path.resolve(__dirname, '..', 'encrypted-state-backup.js'), 'utf8');
    const encryptedRecoverySource = await fs.readFile(path.resolve(__dirname, '..', 'encrypted-state-recovery.js'), 'utf8');
    const encryptedRecoveryCommandSource = await fs.readFile(path.resolve(__dirname, 'restore-encrypted-state-backup.js'), 'utf8');
    const launchRunbook = await fs.readFile(path.resolve(__dirname, '..', 'docs', 'production-stripe-launch.md'), 'utf8');
    const renderBlueprint = await fs.readFile(path.resolve(__dirname, '..', 'render.yaml'), 'utf8');
    const productionWorkflow = await fs.readFile(path.resolve(__dirname, '..', '.github', 'workflows', 'production-gate.yml'), 'utf8');
    const liveSecurityProbeSource = await fs.readFile(path.resolve(__dirname, 'live-security-probe.js'), 'utf8');
    const liveProbeRequestSource = await fs.readFile(path.resolve(__dirname, '..', 'live-probe-request.js'), 'utf8');
    const publicLinkSecurityCheckSource = await fs.readFile(path.resolve(__dirname, 'public-link-security-check.js'), 'utf8');
    assert(serverSource.includes("url.pathname === '/healthz'") && serverSource.includes("release: ASSET_VERSION"), 'Production must expose a minimal unauthenticated health route without loading the staff workspace.');
    assert(serverSource.includes('process.env.RENDER_GIT_COMMIT') && serverSource.includes('commit: WOA_DEPLOY_COMMIT'), 'Production health must expose the short Render commit SHA for exact deploy verification.');
    assert(/healthCheckPath:\s*\/healthz/.test(renderBlueprint), 'Render must probe the dedicated health route instead of treating an open port as application readiness.');
    assert(/autoDeployTrigger:\s*checksPass/.test(renderBlueprint), 'Render must wait for the repository production gate before deploying main.');
    assert(/branches:\s*\[main\]/.test(productionWorkflow) && /npm run check/.test(productionWorkflow) && /timeout-minutes:\s*20/.test(productionWorkflow), 'The main production gate must run the complete regression suite with a bounded timeout.');
    assert(packageSource.includes('scripts/dependency-vulnerability-check.js')
      && dependencyVulnerabilityCheckSource.includes("process.env.GITHUB_ACTIONS === 'true'")
      && dependencyVulnerabilityCheckSource.includes("['audit', '--omit=dev', '--audit-level=high']"), 'The mandatory CI precheck must reject known high-severity runtime dependency vulnerabilities before Render deploys main.');
    assert(packageSource.includes('"repair-data-check": "node scripts/repair-data-check.js"')
      && repairDataSource.includes('const [sourceArgument, outputArgument] = userArguments()')
      && repairDataSource.includes("fs.open(temporary, 'wx', 0o600)")
      && repairDataSource.includes('await fs.link(temporary, file)')
      && repairDataSource.includes('checksum(sourceAfterWrite) !== sourceChecksum')
      && repairDataCheckSource.includes('Successful repair must never change its source')
      && repairDataCheckSource.includes('Repair must refuse to replace an existing protected copy'), 'Manual JSON repair must require an explicit separate output, preserve the source checksum, create an owner-only non-overwriting copy, and retain regression coverage.');
    const repairDataCheck = spawnSync(process.execPath, [path.resolve(__dirname, 'repair-data-check.js')], {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      encoding: 'utf8'
    });
    assert.strictEqual(repairDataCheck.status, 0, 'The copy-only repair regression check must pass inside the mandatory production foundation gate: ' + (repairDataCheck.stderr || repairDataCheck.stdout));
    ['Customer portal state', 'Star approval action', 'Deep business report', 'Accounting ledger', 'Verification and insurance cases', 'Clover reconciliation', 'Refund execution', 'Payment-provider cutover', 'Autopay execution'].forEach(label => {
      assert(liveSecurityProbeSource.includes(label), 'The live anonymous-access probe must cover the ' + label + ' boundary.');
    });
    ['Missing payment bearer link', 'Missing card-setup bearer link', 'Missing onboarding bearer link', 'Missing toll-receipt bearer link'].forEach(label => {
      assert(liveSecurityProbeSource.includes(label), 'The live security probe must cover the ' + label + ' boundary.');
    });
    assert(liveSecurityProbeSource.includes("assert.deepEqual(Object.keys(body).sort(), ['error', 'ok']"), 'Anonymous API failures must be checked for metadata leakage, not only an HTTP status.');
    assert(liveSecurityProbeSource.includes('requestWithRenderRetry')
      && liveProbeRequestSource.includes("header('x-render-routing')")
      && liveProbeRequestSource.includes("header('content-security-policy')")
      && liveProbeRequestSource.includes("header('x-render-origin-server')")
      && liveProbeRequestSource.includes('attempt === maxAttempts')
      && liveProbeRequestSource.includes('Math.min(3'), 'The live probe must retry only confirmed Render routing errors, keep retries bounded, and leave application failures visible.');
    assert(packageSource.includes('node scripts/public-link-security-check.js')
      && publicLinkSecurityCheckSource.includes('Unsigned failure returns must not mutate payment or recurring status')
      && publicLinkSecurityCheckSource.includes('A completed card setup token must be single-use')
      && publicLinkSecurityCheckSource.includes('New payment links must use a 192-bit random public identifier')
      && publicLinkSecurityCheckSource.includes('Repeated public checkout mutations must hit a persistent rate limit'), 'The mandatory production gate must cover public payment/card link entropy, expiry, one-time use, provider-authoritative outcomes, and abuse limits.');
    assert(serverSource.includes("crypto.randomBytes(24).toString('hex')")
      && serverSource.includes('PUBLIC_LINK_RESPONSE_HEADERS')
      && serverSource.includes('No failed payment was recorded')
      && serverSource.includes("publicActionLimit(req, 'payment-link-checkout'")
      && serverSource.includes("publicActionLimit(req, 'card-setup-complete'"), 'Public money links must use high-entropy expiring bearer IDs, private response headers, provider-authoritative failure status, and persistent mutation limits.');
    const onboardingLinkRouteSource = serverSource.slice(
      serverSource.indexOf("url.pathname === '/api/onboarding/links'"),
      serverSource.indexOf("url.pathname === '/api/onboarding/review'")
    );
    assert(onboardingLinkRouteSource.includes('assertStripeCardPreparationReady()')
      && !onboardingLinkRouteSource.includes('assertStripeMoneyActionsArmed()'), 'Creating a Stripe onboarding link must allow protected Identity and SetupIntent proof collection without arming any charge, refund, dispute, autopay, or cutover money action.');
    assert(postgresRuntimeCheckSource.includes("process.env.GITHUB_ACTIONS === 'true'")
      && postgresRuntimeCheckSource.includes("'postgres:18-alpine'")
      && postgresRuntimeCheckSource.includes("'pg_isready'")
      && postgresRuntimeCheckSource.includes('startGitHubPostgres()'), 'The main production gate must start and test against an isolated real PostgreSQL container instead of silently skipping transactional recovery checks.');
    assert(postgresRuntimeCheckSource.includes('WOA_TEST_DATABASE_SSL_MODE') && postgresRuntimeCheckSource.includes('sslMode: databaseSslMode'), 'The PostgreSQL runtime check must support the isolated CI database without weakening production TLS defaults.');
    assert(objectStorageRuntimeCheckSource.includes("process.env.GITHUB_ACTIONS === 'true'")
      && objectStorageRuntimeCheckSource.includes("'minio/minio:RELEASE.2025-09-07T16-13-09Z'")
      && objectStorageRuntimeCheckSource.includes("'minio/mc:RELEASE.2025-08-13T08-35-41Z'")
      && objectStorageRuntimeCheckSource.includes('startGitHubMinio()')
      && objectStorageRuntimeCheckSource.includes('publicReadBlocked === true')
      && objectStorageRuntimeCheckSource.includes('immutableWriteProtected === true')
      && objectStorageRuntimeCheckSource.includes('private_object_already_exists'), 'The main production gate must test encryption, privacy, and immutable writes against an isolated real S3-compatible server instead of trusting only a fetch mock.');
    assert(secureDocumentStoreSource.includes('STORAGE_VALIDATION_PROOF_VERSION')
      && secureDocumentStoreSource.includes('forbidden private storage overwrite')
      && serverSource.includes('lastValidationImmutableWriteProtected')
      && serverSource.includes('lastValidationObjectDeleted'), 'The deployed owner validation must prove immutable object writes and deletion, and those proof fields must remain server-controlled.');
    assert(/maxShutdownDelaySeconds:\s*60/.test(renderBlueprint), 'Render must allow enough time for active money actions and state writes to drain.');
    assert(serverSource.includes('async function gracefulShutdown') && serverSource.includes("process.once('SIGTERM'") && serverSource.includes('await writeDataQueue.catch'), 'Production shutdown must stop accepting requests and drain queued state writes before exit.');
    assert(serverSource.includes("fatalProcessMonitor.installFatalProcessHandlers(process, fatalMonitor)")
      && fatalProcessMonitorSource.includes("processRef.on('uncaughtException'")
      && fatalProcessMonitorSource.includes("processRef.on('unhandledRejection'")
      && fatalProcessMonitorSource.includes("severity: 'critical'")
      && fatalProcessMonitorSource.includes("shutdown('fatal-' + sourceKind, 1)"), 'Top-level process failures must persist one critical incident, attempt the owner-alert path, drain writes, and exit non-zero.');
    await verifyGracefulShutdown(path.resolve(__dirname, '..'), path.join(temp, 'graceful-runtime'));
    assert(serverSource.includes('function reportBackgroundTaskFailure') && serverSource.includes("recordOperationalFailure(source, error, context, { alert: true })"), 'Every scheduled worker failure must use the shared durable monitor and owner-alert path.');
    assert(onboardingSource.includes('async function saveSignedContractArtifact')
      && onboardingSource.includes('Artifact format: wheelsonauto-signed-contract-v1')
      && serverSource.includes("documentKind: 'signed_contract'")
      && serverSource.includes('attachPrivateDocumentRollback(error, privateArtifacts)'), 'E-sign must preserve the exact rendered agreement and signature certificate as an immutable private artifact, link it to the customer document file, and remove every uncommitted object if the state transaction fails.');
    assert(serverSource.includes('Artifact format: wheelsonauto-payment-receipt-v1')
      && serverSource.includes('Artifact format: wheelsonauto-dispute-evidence-v1')
      && serverSource.includes('async function runPrivateArtifactBackfill')
      && serverSource.includes('async function preparePrivateArtifactsForProductionStartup')
      && serverSource.includes(".then(() => preparePrivateArtifactsForProductionStartup())")
      && serverSource.includes("reportBackgroundTaskFailure('private-artifact-storage'")
      && serverSource.includes("missing.push('encrypted payment receipt and dispute evidence artifact backfill')"), 'Paid transactions and owner-reviewed dispute packets must become encrypted immutable artifacts through a durable retry worker, and launch must fail closed while any required artifact is missing.');
    assert(stateRepositorySource.includes('CREATE TABLE IF NOT EXISTS woa_resource_index') && stateRepositorySource.includes('CREATE TABLE IF NOT EXISTS woa_active_assignments'), 'PostgreSQL must normalize critical records and active vehicle assignments into transactionally synchronized indexes.');
    assert(stateRepositorySource.includes('exactDuplicateCriticalResourcePlan')
      && stateRepositorySource.includes('collapseExactDuplicateCriticalResources')
      && postgresSourceRepairSource.includes("WOA_POSTGRES_SOURCE_REPAIR_CONFIRM !== 'EXACT_DUPLICATES_ONLY'")
      && postgresSourceRepairSource.includes("fs.open(file, 'wx', 0o600)")
      && postgresSourceRepairSource.includes('assertSourceUnchanged(sourceFile, source.sourceFileChecksum)')
      && postgresSourceRepairCheckSource.includes('Protected-copy preparation must never rewrite the live source')
      && packageSource.includes('node scripts/postgres-source-repair-check.js'), 'Production migration repair must be checksum-locked, exact-duplicate-only, non-overwriting, owner-readable, live-source preserving, and mandatory in the main gate.');
    assert(postgresPreflightSource.includes('repairableExactDuplicates')
      && postgresPreflightSource.includes('nonidenticalCriticalDuplicates')
      && postgresPreflightSource.includes('prepare-postgres-migration-source'), 'PostgreSQL preflight must report every exact and non-identical duplicate group in one run and direct safe duplicates to the protected-copy workflow.');
    assert(postgresImporterSource.includes('assertTransactionalSourceReady(state)')
      && postgresVerifierSource.includes('assertTransactionalSourceReady(state)'), 'PostgreSQL import and migration proof must reject provider identity, critical record, and active assignment conflicts before a database connection.');
    assert(postgresLockRecoverySource.includes("WOA_MIGRATION_MAINTENANCE_MODE || '') !== '1'")
      && postgresLockRecoverySource.includes('migrationMaintenanceLease.assertActiveLease')
      && postgresLockRecoverySource.includes('assertSameMaintenanceLease(activeMaintenanceLease)')
      && postgresLockRecoverySource.includes('maintenanceLeaseSignatureChecksum: activeMaintenanceLease.signatureChecksum')
      && stateMigrationLockSource.includes("assertMaintenance('before_lock_recovery')")
      && stateMigrationLockSource.includes("assertMaintenance('after_lock_recovery')")
      && stateMigrationLockSource.includes('await fs.link(recoveryFile, status.file)'), 'Stale PostgreSQL lock recovery must require active signed maintenance, recheck it around the rename, restore the lock on a lease failure, and retain safe service, commit, process, and lease evidence before restoring writes.');
    assert(postgresMigrationSource.includes('RENDER_LIVE_DISK_SNAPSHOT')
      && postgresMigrationSource.includes("createHmac('sha256'")
      && postgresMigrationSource.includes('RENDER_SERVICE_ID')
      && postgresMigrationSource.includes('migrationMaintenanceLease.assertActiveLease')
      && postgresMigrationSource.includes('maintenanceInstanceId')
      && postgresMigrationSource.includes('source provenance is stale')
      && migrationMaintenanceLeaseSource.includes('HMAC-SHA256')
      && migrationMaintenanceLeaseSource.includes('renderCommit')
      && migrationMaintenanceLeaseSource.includes('heartbeatAt')
      && serverSource.includes('startMigrationMaintenanceLease()')
      && serverSource.includes('migrationMaintenanceLeaseController.stop()')
      && serverSource.includes("maintenanceLeaseStatus = 'invalid'")
      && serverSource.includes('migrationMaintenanceLease.assertActiveLease({ dataDir: DATA_DIR')
      && postgresSourceRepairSource.includes('migrationMaintenanceLease.assertActiveLease')
      && postgresSourceRepairSource.includes('createProvenanceManifest')
      && postgresMigrationSource.includes('assertSameProvenanceManifest')
      && postgresImporterSource.includes('assertProvenanceManifest')
      && (postgresImporterSource.match(/assertSameProvenanceManifest/g) || []).length >= 3
      && postgresVerifierSource.includes('assertProvenanceManifest')
      && (postgresVerifierSource.match(/assertSameProvenanceManifest/g) || []).length >= 2, 'Production PostgreSQL import and proof must repeatedly require the same fresh HMAC-signed lease and service-bound Render live-disk snapshot across the database write, proof record, and sentinel instead of trusting a command flag, one startup check, or stale developer checkout.');
    assert(launchRunbook.includes('prepare-postgres-migration-source')
      && launchRunbook.includes('never resolves a customer/vehicle assignment by guessing')
      && launchRunbook.includes('repository-checkout `data.json` is **not** authoritative')
      && launchRunbook.includes('migrationMaintenanceLease')
      && launchRunbook.includes('.wheelsonauto-migration-maintenance-lease.json')
      && launchRunbook.includes('WOA_POSTGRES_MIGRATION_PROVENANCE_CONFIRM=RENDER_LIVE_DISK_SNAPSHOT')
      && launchRunbook.includes('**new**\n`protectedCopyChecksum`'), 'The launch runbook must document the signed live-disk audit trail and the protected-copy checksum required after exact duplicate collapse.');
    assert.strictEqual(new Set(stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS).size, stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS.length, 'Every required PostgreSQL schema migration ID must be unique so readiness cannot silently collapse duplicate requirements.');
    assert(stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS.includes(stateRepository.RECOVERY_HISTORY_MIGRATION_ID)
      && stateRepositorySource.includes('CREATE TABLE IF NOT EXISTS woa_recovery_history')
      && stateRepositorySource.includes('UNIQUE (organization_id, event_type, event_id)'), 'PostgreSQL must retain append-only, company-scoped recovery history with a database-enforced event identity.');
    assert(stateRepositorySource.includes('MIGRATION_SOURCE_PROVENANCE_MIGRATION_ID')
      && stateRepositorySource.includes('protected_source_file_checksum')
      && stateRepositorySource.includes('source_manifest_checksum')
      && stateRepositorySource.includes('source_signature_checksum')
      && stateRepositorySource.includes('migrationSourceProvenanceReady'), 'PostgreSQL must retain signed live-source provenance in its durable import proof and fail readiness for legacy checksum-only evidence.');
    assert(stateRepositorySource.includes('pg_advisory_xact_lock') && stateRepositorySource.includes("advisoryLockKeys('wheelsonauto-platform', 'postgres-schema-migrations')"), 'PostgreSQL schema upgrades must be serialized across overlapping Render instances.');
    assert(stateRepositorySource.includes('PRIMARY KEY (organization_id, provider, event_id)') && stateRepositorySource.includes('$webhook_tenant_primary_key$'), 'Webhook uniqueness must be company-scoped for current and previously migrated PostgreSQL databases.');
    assert(stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS.includes(stateRepository.WEBHOOK_CLAIM_TOKEN_MIGRATION_ID)
      && stateRepositorySource.includes("ADD COLUMN IF NOT EXISTS claim_token TEXT NOT NULL DEFAULT ''")
      && stateRepositorySource.includes("error.code = 'woa_webhook_claim_not_owned'"), 'Webhook recovery must assign a durable lease token and fail the state transaction when a stale worker no longer owns the provider event.');
    assert(serverSource.includes("claimWebhookEvent('clover'") && serverSource.includes("completeWebhookEvent('clover'") && serverSource.includes("failWebhookEvent('clover'"), 'Clover payment/dispute callbacks must use the durable PostgreSQL webhook ledger.');
    assert(serverSource.includes("claimWebhookEvent('messaging:'") && serverSource.includes("completeWebhookEvent('messaging:'") && serverSource.includes("failWebhookEvent('messaging:'"), 'SMS callbacks must use the durable PostgreSQL webhook ledger before creating messages or Star drafts.');
    assert(serverSource.includes("claimWebhookEvent('email:'") && serverSource.includes("completeWebhookEvent('email:'") && serverSource.includes("failWebhookEvent('email:'"), 'Email callbacks must use the durable PostgreSQL webhook ledger before creating messages or Star drafts.');
    assert(stateRepositorySource.includes('listRecoverableWebhookEvents') && stateRepositorySource.includes('woa_webhook_events_recovery_idx'), 'The durable webhook ledger must expose bounded failed/stale recovery with a company-and-provider-scoped PostgreSQL index.');
    assert(serverSource.includes('async function recoverTelnyxWebhookEvents') && serverSource.includes('processClaimedTelnyxWebhookEvent') && serverSource.includes('event: payload'), 'Telnyx must durably retain its signed event body and recover failed or interrupted background processing.');
    assert(stateRepositorySource.includes('applyStateTransactionEffects') && stateRepositorySource.includes('normalizedStateTransactionEffects') && serverSource.includes('stageStateTransactionEffects'), 'Provider webhook completion and Stripe billing-period settlement must be staged inside the same PostgreSQL transaction as the authoritative state write.');
    assert(serverSource.includes("webhookCompletions: [{ provider: 'clover', eventId: durableEventId, claimToken: claim.claimToken }]")
      && serverSource.includes("webhookCompletions: [{ provider: 'stripe', eventId: event.id || '', claimToken: durableClaim.claimToken }]")
      && serverSource.includes("claimToken: claim.claimToken"), 'Live Stripe, Clover, SMS, email, and Telnyx recovery handlers must pass their current repository-issued webhook ownership token instead of inventing or reusing one.');
    assert(stateRepositorySource.includes('await this.syncCriticalResourceIndex(client, next)') && stateRepositorySource.includes('await this.syncActiveAssignmentIndex(client, next)'), 'Normal writes and controlled recovery must synchronize critical record and assignment indexes in the state transaction.');
    assert(serverSource.includes('WOA_ERROR_RECORD_WINDOW_MS') && serverSource.includes('operationalErrorRecords'), 'Repeated background failures must be rate-limited before they flood durable operational logs.');
    assert(serverSource.includes('claimJobErrorAlert') && serverSource.includes('releaseJobErrorAlert') && serverSource.includes('operational-error-'), 'Owner error alerts must use a durable cross-restart claim plus provider idempotency instead of a process-memory throttle alone.');
    const operationalFailureStart = serverSource.indexOf('async function recordOperationalFailure');
    const operationalFailureEnd = serverSource.indexOf('function reportBackgroundTaskFailure', operationalFailureStart);
    const operationalFailureBody = serverSource.slice(operationalFailureStart, operationalFailureEnd);
    assert(operationalFailureStart >= 0 && operationalFailureEnd > operationalFailureStart && !operationalFailureBody.includes('...context'), 'Operational monitoring must whitelist safe context instead of persisting arbitrary request or provider secrets.');
    [
      'clover-webhook-auto-sync',
      'telnyx-webhook-processing',
      'twilio-inbound-setup',
      'telnyx-inbound-setup',
      'twilio-inbound-sync',
      'telnyx-delivery-sync',
      'telnyx-webhook-recovery',
      'clover-auto-sync',
      'autopay-run',
      'verification-monitor',
      'passtime-gps-sync',
      'private-artifact-storage',
      'encrypted-state-backup'
    ].forEach(sourceName => {
      assert(serverSource.includes("reportBackgroundTaskFailure('" + sourceName + "'"), 'Scheduled worker ' + sourceName + ' must report failures through the durable monitor.');
    });
    assert(encryptedBackupSource.includes("encryption: 'AES-256-GCM'") && encryptedBackupSource.includes('pointer.signature = pointerSignature') && encryptedBackupSource.includes('previousPointerBytes'), 'Offsite state backups must use authenticated encryption, a signed latest pointer, and rollback to the previous known-good pointer after failed read-back.');
    assert(privateDocumentMigrationSource.includes('migrationMaintenanceLease.assertActiveLease')
      && privateDocumentMigrationSource.includes('assertSameMaintenanceLease(activeMaintenanceLease)')
      && privateDocumentMigrationSource.includes('maintenanceLeaseSignatureChecksum: activeMaintenanceLease.signatureChecksum')
      && privateDocumentMigrationSource.indexOf('assertSameMaintenanceLease(activeMaintenanceLease)') < privateDocumentMigrationSource.indexOf('await fs.rename(temporary, dataFile)')
      && privateDocumentMigrationSource.includes('restoreBackupIfCommittedStateUnchanged')
      && privateDocumentMigrationSource.includes('sha256(immediatelyBeforeReplace) !== committedChecksum')
      && privateDocumentMigrationSource.includes('The newer state and encrypted objects were retained for operator review'), 'Private-document migration must require a signed deployed-service maintenance lease, re-prove the same process immediately before its atomic state replacement, and refuse to overwrite newer state during rollback.');
    assert(encryptedRecoverySource.includes('preserveAccessControlAcrossRecovery')
      && encryptedRecoverySource.includes("maintenanceAssertion('before_backup_read')")
      && encryptedRecoverySource.includes("maintenanceAssertion('before_state_write')")
      && encryptedRecoverySource.indexOf("maintenanceAssertion('before_state_write')") < encryptedRecoverySource.indexOf('repository.write(restored')
      && encryptedRecoverySource.includes("maintenanceAssertion('after_readback_verification')")
      && encryptedRecoverySource.includes('verifiedChecksum'), 'Offsite recovery must preserve current access control, re-prove maintenance before mutation, commit through PostgreSQL, and verify the recovered state and maintenance process through a second read.');
    assert(encryptedRecoveryCommandSource.includes('migrationMaintenanceLease.assertActiveLease')
      && encryptedRecoveryCommandSource.includes('assertSameMaintenanceLease(activeMaintenanceLease)')
      && encryptedRecoveryCommandSource.includes('maintenanceAssertion: () => assertSameMaintenanceLease(activeMaintenanceLease)')
      && encryptedRecoveryCommandSource.includes('maintenanceLeaseSignatureChecksum: activeMaintenanceLease.signatureChecksum'), 'The production restore command must bind every recovery maintenance assertion and operator result to the exact signed Render service, commit, and process lease.');
    const recoveryTargetGuard = spawnSync(process.execPath, ['scripts/postgres-runtime-check.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        WOA_TEST_DATABASE_URL: 'postgres://test-user:test-password@localhost:5432/wheelsonauto',
        WOA_POSTGRES_RUNTIME_TEST_CONFIRM: '1',
        WOA_POSTGRES_RUNTIME_PROOF_RECORD: '1',
        WOA_POSTGRES_RUNTIME_PROOF_CONFIRM: '1',
        WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL: 'postgres://production-user:production-password@localhost:5432/wheelsonauto?sslmode=require',
        WOA_SESSION_SECRET: 'foundation-recovery-session-secret'
      },
      encoding: 'utf8'
    });
    assert.strictEqual(recoveryTargetGuard.status, 1, 'A recovery proof run must fail before opening a database when its test target matches the production proof target.');
    assert.match([recoveryTargetGuard.stdout, recoveryTargetGuard.stderr].filter(Boolean).join(''), /different dedicated test database/i, 'The recovery proof refusal must explain that the test database cannot be production.');
    assert(launchRunbook.includes('WOA_POSTGRES_RUNTIME_PROOF_RECORD=1') && launchRunbook.includes('WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL') && /same database as\n+the production proof target/i.test(launchRunbook), 'The production runbook must explain that recovery proof is recorded only after import from a separate test database.');
    assert(launchRunbook.includes('Validate private storage') && launchRunbook.includes('restore-encrypted-state-backup') && launchRunbook.includes('RESTORE LATEST ENCRYPTED STATE BACKUP') && launchRunbook.includes('Check Stripe account') && launchRunbook.includes('WheelsonAuto customer app') && launchRunbook.includes('Test Star provider') && launchRunbook.includes('Test failure alerts') && launchRunbook.includes('Live launch preflight'), 'The production runbook must give the owner the exact backup, recovery, first-party messaging, and provider proof actions needed to clear the launch gate.');
    const legacyPureStripe = { paymentProvider: 'stripe', stripeCustomerId: 'cus_foundation_pure', stripePaymentMethodId: 'pm_foundation_pure' };
    assert.strictEqual(stripeMigration.migrationRecord(legacyPureStripe).state, stripeMigration.STATES.STRIPE_ACTIVE, 'A legacy Stripe-only customer must remain Stripe-active without an unnecessary Clover cutover state.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed(legacyPureStripe, 'stripe', '2026-07-24'), true, 'A Stripe-only customer should remain eligible for its normal Stripe autopay run.');
    const ambiguousLegacyStripe = { ...legacyPureStripe, cloverCustomerId: 'clover-foundation-legacy', cloverPaymentSource: 'clover-foundation-source' };
    assert.strictEqual(stripeMigration.migrationRecord(ambiguousLegacyStripe).state, stripeMigration.STATES.STRIPE_CARD_SAVED, 'A legacy Stripe row that still has a Clover source must fail closed into the protected cutover state.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed(ambiguousLegacyStripe, 'stripe', '2026-07-24'), false, 'An ambiguous legacy Stripe/Clover row must not autocharge until the owner completes the controlled cutover.');
    const multiPlanCustomer = {
      recurringPayments: [
        { id: 'rec-plan-a', status: 'Active', paymentProvider: 'clover', customer: 'Same Customer', cloverCustomerId: 'clover-same-customer', cloverPaymentSource: 'source-plan-a', cloverSubscriptionId: 'sub-plan-a' },
        { id: 'rec-plan-b', status: 'Active', paymentProvider: 'clover', customer: 'Same Customer', cloverCustomerId: 'clover-same-customer', cloverPaymentSource: 'source-plan-b', cloverSubscriptionId: 'sub-plan-b' }
      ],
      integrations: { clover: { lastRecurringVerifiedSubscriptionIds: ['sub-plan-a', 'sub-plan-b'] } }
    };
    const multiPlanEligibility = stripeMigration.cutoverEligibility(multiPlanCustomer, multiPlanCustomer.recurringPayments[0]);
    assert.strictEqual(multiPlanEligibility.eligible, true, 'Separate plans for the same customer must remain eligible when each has its own Clover subscription ID.');
    assert.strictEqual(multiPlanEligibility.code, 'verified_multi_plan_customer', 'A verified multi-plan customer must remain explicit in cutover evidence.');
    assert.strictEqual(multiPlanEligibility.relatedPlanCount, 2, 'Cutover evidence must disclose the customer\'s other distinct Clover plans.');
    assert.strictEqual(multiPlanEligibility.providerRosterMatched, true, 'A protected cutover must prove the exact subscription came from the server-owned Clover roster.');
    const missingVerifiedRoster = stripeMigration.cutoverEligibility({ recurringPayments: multiPlanCustomer.recurringPayments }, multiPlanCustomer.recurringPayments[0]);
    assert.strictEqual(missingVerifiedRoster.eligible, false, 'A browser-entered subscription ID must not cut over without a provider roster snapshot.');
    assert.strictEqual(missingVerifiedRoster.code, 'missing_verified_clover_roster', 'Missing provider roster evidence must expose a stable quarantine code.');
    const mismatchedVerifiedRoster = stripeMigration.cutoverEligibility({ recurringPayments: multiPlanCustomer.recurringPayments, integrations: { clover: { lastRecurringVerifiedSubscriptionIds: ['different-subscription'] } } }, multiPlanCustomer.recurringPayments[0]);
    assert.strictEqual(mismatchedVerifiedRoster.eligible, false, 'A fresh Clover roster for a different subscription must not authorize this row.');
    assert.strictEqual(mismatchedVerifiedRoster.code, 'clover_subscription_not_in_verified_roster', 'Mismatched provider roster evidence must expose a stable quarantine code.');
    const missingSubscriptionEligibility = stripeMigration.cutoverEligibility({ recurringPayments: [{ ...multiPlanCustomer.recurringPayments[0], cloverSubscriptionId: '' }] }, { ...multiPlanCustomer.recurringPayments[0], cloverSubscriptionId: '' });
    assert.strictEqual(missingSubscriptionEligibility.eligible, false, 'A Clover row without an exact subscription ID must stay quarantined instead of relying on a customer-name guess.');
    assert.strictEqual(missingSubscriptionEligibility.code, 'missing_clover_subscription_id', 'The missing-subscription quarantine must expose a stable reason code.');
    const duplicatedSubscriptionState = {
      recurringPayments: [
        multiPlanCustomer.recurringPayments[0],
        { ...multiPlanCustomer.recurringPayments[1], cloverSubscriptionId: 'sub-plan-a' }
      ],
      integrations: { clover: { lastRecurringVerifiedSubscriptionIds: ['sub-plan-a'] } }
    };
    const duplicateSubscriptionEligibility = stripeMigration.cutoverEligibility(duplicatedSubscriptionState, duplicatedSubscriptionState.recurringPayments[0]);
    assert.strictEqual(duplicateSubscriptionEligibility.eligible, false, 'Two active local rows must never cut over against the same Clover subscription ID.');
    assert.strictEqual(duplicateSubscriptionEligibility.code, 'duplicate_clover_subscription_id', 'Duplicate-subscription quarantine must expose a stable reason code.');
    const planLinkReview = cardSetupPlanReview({
      ...multiPlanCustomer,
      cardSetupRequests: [
        { id: 'setup-legacy-ambiguous', customer: 'Same Customer', paymentProvider: 'stripe', amount: 229, frequency: 'Weekly', status: 'Open', createdAt: '2026-07-21T12:00:00.000Z', expiresAt: '2099-07-28T12:00:00.000Z', url: 'https://example.test/setup-card/private-token' },
        { id: 'setup-exact-plan-a', recurringPaymentId: 'rec-plan-a', customer: 'Same Customer', paymentProvider: 'stripe', amount: 229, frequency: 'Weekly', status: 'Open', expiresAt: '2099-07-28T12:00:00.000Z' },
        { id: 'setup-complete', customer: 'Same Customer', paymentProvider: 'stripe', amount: 229, frequency: 'Weekly', status: 'Card saved', completedAt: '2026-07-21T13:00:00.000Z', expiresAt: '2099-07-28T12:00:00.000Z' }
      ]
    });
    assert.strictEqual(planLinkReview.length, 1, 'Only the active ambiguous legacy setup link should require exact-plan review.');
    assert.strictEqual(planLinkReview[0].code, 'card_setup_plan_ambiguous', 'The exact-plan review must expose a stable ambiguity code.');
    assert.strictEqual(planLinkReview[0].customer, 'Same Customer', 'The owner review must identify the affected customer without exposing a bearer link.');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(planLinkReview[0], 'id'), false, 'The review must not expose the card-setup bearer identifier.');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(planLinkReview[0], 'url'), false, 'The review must not expose the card-setup bearer URL.');

    const repository = stateRepository.createStateRepository({ backend: 'json', dataFile, seedFile });
    const jsonReadiness = await repository.readiness();
    assert.strictEqual(jsonReadiness.connected, true, 'The deployment readiness probe must accept a readable JSON seed in compatibility mode.');
    assert.strictEqual(jsonReadiness.stateAvailable, true, 'The deployment readiness probe must confirm that application state is available.');
    const jsonAutopayLock = await repository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(jsonAutopayLock.acquired, true, 'The JSON development fallback should retain the in-process autopay lock contract.');
    await jsonAutopayLock.release();
    assert.strictEqual((await repository.checkRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'A fresh local security throttle must allow the first attempt.');
    assert.strictEqual((await repository.consumeRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'The local security throttle must consume the first attempt.');
    assert.strictEqual((await repository.consumeRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'The local security throttle must allow the configured final attempt.');
    const blockedJsonRateLimit = await repository.checkRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000);
    assert.strictEqual(blockedJsonRateLimit.allowed, false, 'The local security throttle must block after the configured limit.');
    assert(blockedJsonRateLimit.retryAfterSeconds > 0, 'A blocked local security throttle must return retry guidance.');
    await repository.clearRateLimit('login-failure', 'staff|198.51.100.10|owner');
    assert.strictEqual((await repository.checkRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'A successful local login must clear its failure throttle.');
    const firstJsonWebhookClaim = await repository.claimWebhookEvent('stripe', 'evt-foundation-1', { type: 'payment_intent.succeeded' });
    assert.strictEqual(firstJsonWebhookClaim.accepted, true, 'The first development webhook event should be claimable.');
    const activeJsonWebhookDuplicate = await repository.claimWebhookEvent('stripe', 'evt-foundation-1', { type: 'payment_intent.succeeded' });
    assert.strictEqual(activeJsonWebhookDuplicate.inProgress, true, 'An in-progress development webhook duplicate should not execute twice.');
    await repository.failWebhookEvent('stripe', 'evt-foundation-1', new Error('retry test'), { claimToken: firstJsonWebhookClaim.claimToken });
    const retriedJsonWebhookClaim = await repository.claimWebhookEvent('stripe', 'evt-foundation-1', { type: 'payment_intent.succeeded' });
    assert.strictEqual(retriedJsonWebhookClaim.accepted, true, 'A failed development webhook event should be retryable.');
    assert(retriedJsonWebhookClaim.claimToken && retriedJsonWebhookClaim.claimToken !== firstJsonWebhookClaim.claimToken, 'A retried webhook event must replace the previous worker lease token.');
    assert.strictEqual(await repository.completeWebhookEvent('stripe', 'evt-foundation-1', { claimToken: firstJsonWebhookClaim.claimToken }), false, 'A stale webhook worker must not complete a newer worker claim.');
    assert.strictEqual(await repository.failWebhookEvent('stripe', 'evt-foundation-1', new Error('stale worker'), { claimToken: firstJsonWebhookClaim.claimToken }), false, 'A stale webhook worker must not fail a newer worker claim.');
    assert.strictEqual(await repository.completeWebhookEvent('stripe', 'evt-foundation-1', { claimToken: retriedJsonWebhookClaim.claimToken }), true, 'The current webhook lease owner must be able to complete its claim.');
    assert.strictEqual((await repository.claimWebhookEvent('stripe', 'evt-foundation-1')).accepted, false, 'A completed development webhook event must remain deduplicated.');
    const recoverableTelnyxEvent = { data: { id: 'evt-foundation-telnyx-recovery', event_type: 'message.received', payload: { from: { phone_number: '+13135550199' }, to: [{ phone_number: '+13135550000' }], text: 'Recovery proof' } } };
    const initialTelnyxWebhookClaim = await repository.claimWebhookEvent('messaging:telnyx', 'telnyx:evt-foundation-telnyx-recovery', { type: 'message.received', event: recoverableTelnyxEvent });
    await repository.failWebhookEvent('messaging:telnyx', 'telnyx:evt-foundation-telnyx-recovery', new Error('controlled recovery test'), { claimToken: initialTelnyxWebhookClaim.claimToken });
    const recoverableJsonWebhooks = await repository.listRecoverableWebhookEvents('messaging:telnyx', { retryAfterMs: 0, now: Date.now() + 1 });
    assert.strictEqual(recoverableJsonWebhooks.length, 1, 'A failed local Telnyx webhook must remain discoverable for durable recovery.');
    assert.strictEqual(recoverableJsonWebhooks[0].payload.event.data.id, 'evt-foundation-telnyx-recovery', 'Durable webhook recovery must retain the exact provider event envelope.');
    const telnyxClaimKey = [repository.organizationId, 'messaging:telnyx', 'telnyx:evt-foundation-telnyx-recovery'].join('|');
    repository.webhookEventClaims.get(telnyxClaimKey).processingStartedAt = new Date(Date.now() - 31 * 1000).toISOString();
    repository.webhookEventClaims.get(telnyxClaimKey).status = 'processing';
    repository.webhookProcessingLeaseMs = 30 * 1000;
    const reclaimedJsonWebhook = await repository.claimWebhookEvent('messaging:telnyx', 'telnyx:evt-foundation-telnyx-recovery', { type: 'message.received', event: recoverableTelnyxEvent });
    assert.strictEqual(reclaimedJsonWebhook.accepted, true, 'A stale local webhook processing lease must be reclaimable after a restart.');
    assert.strictEqual(reclaimedJsonWebhook.reclaimed, true, 'A reclaimed local webhook lease must be identified for diagnostics.');
    await repository.completeWebhookEvent('messaging:telnyx', 'telnyx:evt-foundation-telnyx-recovery', { claimToken: reclaimedJsonWebhook.claimToken });
    const atomicRepository = stateRepository.createStateRepository({ backend: 'json', dataFile: path.join(temp, 'atomic-provider-data.json'), seedFile });
    const atomicWebhookEventId = 'evt-foundation-atomic-state';
    const atomicIdempotencyScope = 'stripe_recurring_charge';
    const atomicIdempotencyKey = 'period:rec-foundation-atomic:2026-07-25';
    const atomicWebhookClaim = await atomicRepository.claimWebhookEvent('stripe', atomicWebhookEventId, { type: 'payment_intent.succeeded' });
    await atomicRepository.claimIdempotencyKey(atomicIdempotencyScope, atomicIdempotencyKey, { recurringPaymentId: 'rec-foundation-atomic', amountCents: 22900 });
    const jsonStateBeforeAtomicWrite = (await atomicRepository.read()).state;
    await atomicRepository.write(jsonStateBeforeAtomicWrite, {
      transactionEffects: {
        webhookCompletions: [{ provider: 'stripe', eventId: atomicWebhookEventId, claimToken: atomicWebhookClaim.claimToken }],
        idempotencySettlements: [{ action: 'complete', scope: atomicIdempotencyScope, key: atomicIdempotencyKey, providerAuthoritative: true, response: { paymentIntentId: 'pi-foundation-atomic' } }]
      }
    });
    assert.strictEqual((await atomicRepository.claimWebhookEvent('stripe', atomicWebhookEventId)).accepted, false, 'A state write with a staged webhook completion must leave the provider event deduplicated.');
    const completedAtomicIdempotency = await atomicRepository.claimIdempotencyKey(atomicIdempotencyScope, atomicIdempotencyKey, { recurringPaymentId: 'rec-foundation-atomic', amountCents: 22900 });
    assert.strictEqual(completedAtomicIdempotency.completed, true, 'A state write with a staged provider settlement must complete the matching billing-period claim.');
    const idempotencyScope = 'stripe_recurring_charge';
    const idempotencyKey = 'period:rec-foundation-1:2026-07-24';
    const idempotencyRequest = { recurringPaymentId: 'rec-foundation-1', billingPeriodKey: 'due:2026-07-24', amountCents: 22900 };
    const firstJsonIdempotencyClaim = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(firstJsonIdempotencyClaim.accepted, true, 'The first local Stripe billing-period claim must be accepted.');
    assert(firstJsonIdempotencyClaim.claimToken, 'A local Stripe billing-period claim must receive a unique lease token.');
    const activeJsonIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(activeJsonIdempotencyDuplicate.inProgress, true, 'A concurrent local Stripe billing-period claim must remain protected while the first request is processing.');
    await assert.rejects(
      () => repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 }),
      error => error && error.code === 'woa_idempotency_request_mismatch',
      'A protected Stripe billing period must reject a changed amount until the first request reaches a terminal state.'
    );
    await repository.failIdempotencyKey(idempotencyScope, idempotencyKey, new Error('controlled decline'));
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_failed_claim_must_not_settle' }, { claimToken: firstJsonIdempotencyClaim.claimToken }), false, 'A failed local Stripe claim must not be converted to paid by a late worker response.');
    const retryJsonIdempotencyClaim = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(retryJsonIdempotencyClaim.accepted, true, 'A terminal local Stripe decline must allow a deliberate corrected retry.');
    assert.strictEqual(retryJsonIdempotencyClaim.retried, true, 'A corrected local Stripe retry must be labeled as a retry.');
    assert.notStrictEqual(retryJsonIdempotencyClaim.claimToken, firstJsonIdempotencyClaim.claimToken, 'A retried local Stripe billing-period claim must replace the old worker lease token.');
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_stale_worker_must_not_win' }, { claimToken: firstJsonIdempotencyClaim.claimToken }), false, 'A stale local Stripe worker must not complete a newer billing-period claim.');
    await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_foundation_idempotency_1', status: 'succeeded' }, { claimToken: retryJsonIdempotencyClaim.claimToken });
    const completedJsonIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(completedJsonIdempotencyDuplicate.completed, true, 'A completed local Stripe billing-period claim must be permanently deduplicated.');
    assert.strictEqual(completedJsonIdempotencyDuplicate.response.paymentIntentId, 'pi_foundation_idempotency_1', 'A completed local Stripe billing-period claim must retain its reconciliation result.');
    const providerClaimKey = 'period:rec-foundation-provider:2026-07-24';
    const providerClaimRequest = { recurringPaymentId: 'rec-foundation-provider', billingPeriodKey: 'due:2026-07-24', amountCents: 22900 };
    const providerClaim = await repository.claimIdempotencyKey(idempotencyScope, providerClaimKey, providerClaimRequest);
    await repository.failIdempotencyKey(idempotencyScope, providerClaimKey, new Error('Worker received a provisional failure.'), { claimToken: providerClaim.claimToken });
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, providerClaimKey, { paymentIntentId: 'pi_provider_late_success', status: 'succeeded' }, { providerAuthoritative: true }), true, 'A signed provider success must authoritatively settle a previously failed local claim.');
    const providerSettledDuplicate = await repository.claimIdempotencyKey(idempotencyScope, providerClaimKey, providerClaimRequest);
    assert.strictEqual(providerSettledDuplicate.completed, true, 'A provider-reconciled late success must permanently close the billing period against another charge.');
    assert.strictEqual(providerSettledDuplicate.response.paymentIntentId, 'pi_provider_late_success', 'Provider reconciliation must retain the exact Stripe PaymentIntent proof.');
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, providerClaimKey, { paymentIntentId: 'pi_conflicting_later_event', status: 'succeeded' }, { providerAuthoritative: true }), true, 'Replaying provider success against a completed claim must remain idempotent.');
    const providerReplay = await repository.claimIdempotencyKey(idempotencyScope, providerClaimKey, providerClaimRequest);
    assert.strictEqual(providerReplay.response.paymentIntentId, 'pi_provider_late_success', 'A completed billing-period claim must preserve its first authoritative PaymentIntent proof.');
    await assert.rejects(() => repository.recordMigrationProof({}), /cannot record a PostgreSQL import proof/i, 'The JSON development fallback must never pretend it recorded production migration evidence.');
    assert.strictEqual(stateRepository.checksum({ b: 2, a: { z: 3, y: 4 } }), stateRepository.checksum({ a: { y: 4, z: 3 }, b: 2 }), 'State checksums must be stable when a JSONB database changes object key order.');
    const intactState = { records: [{ id: 'checksum-foundation-1', status: 'intact' }] };
    const intactChecksum = stateRepository.checksum(intactState);
    assert.strictEqual(stateRepository.checksumEvidence(intactState, intactChecksum).matches, true, 'A PostgreSQL state checksum must verify before the state is served or changed.');
    assert.strictEqual(stateRepository.checksumEvidence({ ...intactState, records: [{ id: 'checksum-foundation-1', status: 'tampered' }] }, intactChecksum).matches, false, 'A modified PostgreSQL state payload must fail checksum verification.');
    assert.throws(() => stateRepository.assertChecksum({ ...intactState, records: [{ id: 'checksum-foundation-1', status: 'tampered' }] }, intactChecksum, 'Foundation snapshot'), /checksum verification failed/i, 'A corrupted state snapshot must fail closed before recovery.');
    const verifiedRecoverySnapshot = stateRepository.recoverySnapshotEvidence({
      id: 5,
      version: 4,
      checksum: intactChecksum,
      state: intactState,
      createdAt: '2026-07-17T12:00:00.000Z'
    }, { version: 4, checksum: intactChecksum, snapshotCount: 5 });
    assert.strictEqual(verifiedRecoverySnapshot.snapshotRecoveryReady, true, 'A checksum-verified snapshot matching the current PostgreSQL version must satisfy the recovery launch gate.');
    assert.strictEqual(stateRepository.recoverySnapshotEvidence(null, { version: 4, checksum: intactChecksum }).snapshotIntegrity, 'missing', 'A PostgreSQL state without a retained snapshot must fail the recovery launch gate.');
    assert.strictEqual(stateRepository.recoverySnapshotEvidence({ id: 4, version: 3, checksum: intactChecksum, state: intactState }, { version: 4, checksum: intactChecksum }).snapshotIntegrity, 'stale', 'A previous PostgreSQL snapshot must not masquerade as the current recovery proof.');
    assert.strictEqual(stateRepository.recoverySnapshotEvidence({ id: 5, version: 4, checksum: intactChecksum, state: { records: [] } }, { version: 4, checksum: intactChecksum }).snapshotIntegrity, 'failed', 'A tampered recovery snapshot must fail checksum verification before live launch.');
    const recoveryDrillFingerprint = stateRepository.recoveryDrillConfigurationFingerprint(
      'foundation-recovery-secret',
      'postgres://foundation-primary/wheelsonauto',
      'org-foundation'
    );
    const recoveryDrillChecks = Object.fromEntries(stateRepository.RECOVERY_DRILL_REQUIRED_CHECKS.map(check => [check, true]));
    const freshRecoveryDrill = {
      runId: 'foundation-recovery-drill-1',
      result: 'passed',
      testDatabaseFingerprint: stateRepository.recoveryDrillConfigurationFingerprint('foundation-recovery-secret', 'postgres://foundation-test/wheelsonauto', 'org-foundation-test'),
      configurationFingerprint: recoveryDrillFingerprint,
      checks: recoveryDrillChecks,
      scriptVersion: stateRepository.RECOVERY_DRILL_SCRIPT_VERSION,
      verifiedAt: new Date().toISOString()
    };
    assert.strictEqual(stateRepository.recoveryDrillEvidence(freshRecoveryDrill, { configurationFingerprint: recoveryDrillFingerprint }).ready, true, 'A fresh passed recovery drill with every required check must satisfy the controlled launch gate.');
    const previousRecoveryContractFingerprint = stateRepository.recoveryDrillConfigurationFingerprint(
      'foundation-recovery-secret',
      'postgres://foundation-primary/wheelsonauto',
      'org-foundation',
      'wheelsonauto-recovery-drill-v1'
    );
    assert.notStrictEqual(previousRecoveryContractFingerprint, recoveryDrillFingerprint, 'A database-safety contract change must invalidate the previous recovery-drill configuration proof.');
    const staleScriptEvidence = stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, scriptVersion: 'postgres-runtime-check-v3' }, { configurationFingerprint: recoveryDrillFingerprint });
    assert.strictEqual(staleScriptEvidence.ready, false, 'A recovery drill from an older test contract must fail closed even when its database fingerprint is current.');
    assert.match(staleScriptEvidence.error, /older database-safety contract/i, 'An outdated recovery drill must explain that the current controlled drill is required.');
    assert.strictEqual(stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, checks: { ...recoveryDrillChecks, serverRestartRead: false } }, { configurationFingerprint: recoveryDrillFingerprint }).ready, false, 'A recovery drill missing a server-restart read must fail closed before live launch.');
    assert.strictEqual(stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, configurationFingerprint: 'old-database-configuration' }, { configurationFingerprint: recoveryDrillFingerprint }).ready, false, 'A recovery drill from an older database configuration must not satisfy the current launch gate.');
    assert.strictEqual(stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, verifiedAt: '2020-01-01T00:00:00.000Z' }, { configurationFingerprint: recoveryDrillFingerprint, maxAgeMs: 60 * 60 * 1000 }).ready, false, 'A stale recovery drill must not satisfy the current launch gate.');
    assert(serverSource.includes('recoveryDrillConfigurationFingerprint: recoveryDrillConfigurationFingerprint()')
      && stateRepositorySource.includes("configurationFingerprint: String(options.recoveryDrillConfigurationFingerprint || '')")
      && postgresRuntimeCheckSource.includes('recoveryDrillConfigurationFingerprint: configurationFingerprint')
      && !serverSource.includes('stateRepository.recoveryDrillEvidence(database.recoveryDrill'), 'Recovery-drill fingerprints must be validated inside PostgreSQL health before its safe evidence is sanitized; production preflight must not revalidate and accidentally discard that proof.');
    await assert.rejects(() => repository.recordRecoveryDrill(freshRecoveryDrill), /cannot record a PostgreSQL recovery drill/i, 'The JSON development fallback must never pretend it recorded a controlled PostgreSQL recovery drill.');
    const sourceCounts = stateRepository.migrationRecordCounts({ vehicles: [{}], customers: [{}], payments: [], auditLogs: [] });
    const migrationProofInput = {
      sourceChecksum: 'raw-json-checksum',
      canonicalSourceChecksum: intactChecksum,
      targetChecksum: intactChecksum,
      sourceRecordCounts: sourceCounts,
      targetRecordCounts: sourceCounts,
      importedVersion: 4,
      snapshotChecksum: intactChecksum,
      provenanceVersion: 2,
      sourceOrigin: 'render-live-disk',
      renderServiceId: 'srv-foundation-proof',
      sourcePreparedAt: '2026-07-17T11:55:00.000Z',
      liveSourceFileChecksum: '1'.repeat(64),
      protectedSourceFileChecksum: '2'.repeat(64),
      sourceManifestChecksum: '3'.repeat(64),
      sourceSignatureChecksum: '4'.repeat(64),
      verifiedAt: '2026-07-17T12:00:00.000Z'
    };
    assert.strictEqual(stateRepository.migrationProofEvidence(migrationProofInput).migrationProofReady, true, 'A JSON-to-PostgreSQL import proof must retain matching canonical source, target, snapshot, and collection-count evidence.');
    assert.strictEqual(stateRepository.migrationProofEvidence({ ...migrationProofInput, targetRecordCounts: { vehicles: 0 } }).migrationProofIntegrity, 'failed', 'A migration proof with changed collection counts must fail closed before live launch.');
    assert.strictEqual(stateRepository.migrationProofEvidence({ ...migrationProofInput, sourceManifestChecksum: '' }).migrationProofReady, false, 'A legacy checksum-only import proof without the signed manifest fingerprint must fail closed.');
    const first = await repository.read();
    assert.strictEqual(first.exists, false, 'A missing local data file must safely use the seed without writing it.');
    const next = {
      vehicles: [{ id: 'vehicle-1', vin: '1HGCM82633A004352', plate: 'WOA-101' }],
      customers: [{ id: 'customer-1', email: 'customer@example.com' }],
      customerAccounts: [{ id: 'account-1', username: 'customer@example.com' }],
      payments: [{ id: 'payment-1', stripePaymentIntentId: 'pi_foundation_1' }],
      documents: [],
      eSignatures: []
    };
    const written = await repository.write(next);
    assert.strictEqual(written.state.vehicles[0].vin, next.vehicles[0].vin, 'The state repository must persist a complete state snapshot.');
    assert.strictEqual((await repository.read()).exists, true, 'The local repository must report a persisted state after write.');
    const stateBeforeJsonJobError = await fs.readFile(dataFile, 'utf8');
    await repository.recordJobError('json-fallback-monitor', new Error('Controlled JSON fallback error'), { route: 'foundation check', source: 'startup' });
    await repository.recordJobError('json-fallback-monitor', new Error('Controlled JSON fallback error'), { route: 'foundation check', source: 'background' });
    const jsonJobErrors = await repository.recentJobErrors(5);
    assert.strictEqual(jsonJobErrors.length, 1, 'The JSON fallback must retain a bounded operational error record until PostgreSQL is enabled.');
    assert.strictEqual(jsonJobErrors[0].occurrenceCount, 2, 'Repeated JSON fallback failures must coalesce into one actionable incident with an occurrence count.');
    assert.strictEqual(jsonJobErrors[0].source, 'json-fallback-monitor', 'The JSON fallback error record must retain its source.');
    assert.strictEqual(jsonJobErrors[0].context.route, 'foundation check', 'The JSON fallback error record must retain safe context.');
    const jsonAlertBase = Date.parse('2026-07-21T12:00:00.000Z');
    const firstJsonAlertClaim = await repository.claimJobErrorAlert(jsonJobErrors[0].id, 6 * 60 * 60 * 1000, jsonAlertBase);
    assert.strictEqual(firstJsonAlertClaim.claimed, true, 'The first JSON fallback owner alert must receive a durable incident claim.');
    assert.strictEqual((await repository.claimJobErrorAlert(jsonJobErrors[0].id, 6 * 60 * 60 * 1000, jsonAlertBase + 60 * 60 * 1000)).claimed, false, 'A restart inside the alert window must not resend the same JSON fallback incident.');
    assert.strictEqual(await repository.releaseJobErrorAlert(jsonJobErrors[0].id, firstJsonAlertClaim.claimedAt), true, 'A failed provider send must release the exact JSON fallback alert claim.');
    assert.strictEqual((await repository.claimJobErrorAlert(jsonJobErrors[0].id, 6 * 60 * 60 * 1000, jsonAlertBase + 60 * 60 * 1000)).claimed, true, 'A released JSON fallback claim must be available for a safe provider retry.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), stateBeforeJsonJobError, 'Recording a JSON fallback operational error must not rewrite business data.json.');
    assert((await fs.stat(dataFile + '.job-errors.json')).size > 0, 'The JSON fallback error log must live beside, not inside, the protected business state file.');
    const resolvedJsonJobError = await repository.resolveJobError(jsonJobErrors[0].id, { resolvedBy: 'foundation owner', note: 'Controlled review completed' });
    assert(resolvedJsonJobError && resolvedJsonJobError.resolvedAt && resolvedJsonJobError.resolvedBy === 'foundation owner', 'The JSON fallback must retain who reviewed an operational error and when.');
    assert.strictEqual(resolvedJsonJobError.occurrenceCount, 2, 'Resolving a grouped JSON fallback incident must retain its total occurrence count.');
    assert.strictEqual(resolvedJsonJobError.resolutionNote, 'Controlled review completed', 'The JSON fallback must retain the owner review note.');
    assert.strictEqual((await repository.recentJobErrors(5)).length, 0, 'A reviewed JSON fallback error must leave the open launch queue without being deleted.');
    assert.strictEqual(await repository.resolveJobError(jsonJobErrors[0].id, { resolvedBy: 'foundation owner' }), null, 'A resolved job error must not be resolved twice.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), stateBeforeJsonJobError, 'Resolving a JSON fallback operational error must not rewrite business data.json.');
    const aiReservation = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiReservation.allowed, true, 'The local development guard must reserve the first Star model request.');
    const aiBlocked = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiBlocked.allowed, false, 'The local development guard must stop a repeated Star request at the configured daily cap.');
    assert.strictEqual(aiBlocked.reason, 'daily_limit', 'The quota guard must explain why Star fell back to rules.');

    const duplicate = { ...next, vehicles: next.vehicles.concat({ id: 'vehicle-2', vin: '1HGCM82633A004352' }) };
    assert.strictEqual(stateRepository.identityConflicts(duplicate).length, 1, 'A duplicate immutable VIN must be found before PostgreSQL migration.');
    const sharedEmail = { ...next, customers: next.customers.concat({ id: 'customer-2', email: 'customer@example.com' }) };
    assert.strictEqual(stateRepository.identityConflicts(sharedEmail).length, 0, 'Repeated customer email aliases must not block migration when Clover or plan history contains multiple rows for one person.');
    const duplicatePortalUsername = { ...next, customerAccounts: next.customerAccounts.concat({ id: 'account-2', username: 'customer@example.com' }) };
    assert.strictEqual(stateRepository.identityConflicts(duplicatePortalUsername).length, 1, 'A duplicate portal username must still block migration because it can expose the wrong customer account.');
    const distinctMultiPlanIdentities = {
      recurringPayments: [
        { id: 'recurring-plan-a', cloverCustomerId: 'clover-shared-customer', stripeCustomerId: 'stripe-shared-customer', cloverSubscriptionId: 'clover-sub-a', stripeSubscriptionId: 'stripe-sub-a' },
        { id: 'recurring-plan-b', cloverCustomerId: 'clover-shared-customer', stripeCustomerId: 'stripe-shared-customer', cloverSubscriptionId: 'clover-sub-b', stripeSubscriptionId: 'stripe-sub-b' }
      ]
    };
    assert.strictEqual(stateRepository.identityConflicts(distinctMultiPlanIdentities).length, 0, 'Shared provider customer IDs must remain valid when each plan has its own subscription IDs.');
    const duplicateCloverSubscription = {
      recurringPayments: [
        distinctMultiPlanIdentities.recurringPayments[0],
        { ...distinctMultiPlanIdentities.recurringPayments[1], cloverSubscriptionId: 'clover-sub-a' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateCloverSubscription).map(conflict => conflict.kind), ['clover_subscription'], 'A Clover subscription ID must never identify two local recurring plans.');
    const duplicateStripeSubscription = {
      recurringPayments: [
        distinctMultiPlanIdentities.recurringPayments[0],
        { ...distinctMultiPlanIdentities.recurringPayments[1], stripeSubscriptionId: 'stripe-sub-a' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateStripeSubscription).map(conflict => conflict.kind), ['stripe_subscription'], 'A Stripe subscription ID must never identify two local recurring plans.');
    const providerScopedVerificationIds = {
      verificationCases: [
        { id: 'verification-stripe-a', provider: 'Stripe Identity', externalCaseId: 'vs_shared_provider_value' },
        { id: 'verification-checkr-b', provider: 'Checkr', externalCaseId: 'vs_shared_provider_value' }
      ]
    };
    assert.strictEqual(stateRepository.identityConflicts(providerScopedVerificationIds).length, 0, 'Different verification providers may legitimately issue the same external identifier value.');
    const duplicateVerificationProviderId = {
      verificationCases: [
        providerScopedVerificationIds.verificationCases[0],
        { ...providerScopedVerificationIds.verificationCases[1], provider: 'stripe identity' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateVerificationProviderId).map(conflict => conflict.kind), ['verification_provider_case:stripe_identity'], 'One verification provider case ID must never resolve to two local customer cases.');
    const repeatedVerificationAliasOnOneCase = {
      verificationCases: [{ id: 'verification-alias-one', provider: 'Canopy', externalCaseId: 'pull-one', providerPullId: 'pull-one' }]
    };
    assert.strictEqual(stateRepository.identityEntries(repeatedVerificationAliasOnOneCase).filter(entry => entry.kind === 'verification_provider_case:canopy').length, 1, 'The same provider identifier stored in two fields on one case must produce one database identity row.');
    const duplicateStripeCharge = {
      payments: [
        { id: 'payment-charge-a', stripeChargeId: 'ch_foundation_duplicate' },
        { id: 'payment-charge-b', stripeChargeId: 'ch_foundation_duplicate' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateStripeCharge).map(conflict => conflict.kind), ['stripe_charge'], 'One Stripe charge must never resolve to two WheelsonAuto payment records.');
    const duplicateStripeCheckout = {
      cardSetupRequests: [{ id: 'card-setup-a', stripeCheckoutSessionId: 'cs_foundation_duplicate' }],
      paymentRequests: [{ id: 'payment-link-b', paymentProvider: 'stripe', stripeCheckoutSessionId: 'cs_foundation_duplicate' }]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateStripeCheckout).map(conflict => conflict.kind), ['stripe_checkout_session'], 'One Stripe Checkout session must never complete two local customer requests.');
    const duplicateStripeSetupIntent = {
      cardSetupRequests: [
        { id: 'card-setup-intent-a', stripeSetupIntentId: 'seti_foundation_duplicate' },
        { id: 'card-setup-intent-b', stripeSetupIntentId: 'seti_foundation_duplicate' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateStripeSetupIntent).map(conflict => conflict.kind), ['stripe_setup_intent'], 'One Stripe SetupIntent must never save a card onto two local setup requests.');
    const duplicateStripeIdentitySession = {
      onboardingSessions: [
        { id: 'onboarding-identity-a', stripeIdentityVerificationId: 'vs_foundation_duplicate' },
        { id: 'onboarding-identity-b', stripeIdentityVerificationId: 'vs_foundation_duplicate' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateStripeIdentitySession).map(conflict => conflict.kind), ['stripe_identity_verification'], 'One Stripe Identity session must never verify two onboarding files.');
    const duplicateStripeDispute = {
      claims: [
        { id: 'claim-dispute-a', stripeDisputeId: 'dp_foundation_duplicate' },
        { id: 'claim-dispute-b', stripeDisputeId: 'dp_foundation_duplicate' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateStripeDispute).map(conflict => conflict.kind), ['stripe_dispute'], 'One Stripe dispute must never create two evidence cases.');
    const duplicateProviderRefund = {
      refundRequests: [
        { id: 'refund-a', paymentProvider: 'stripe', providerRefundId: 're_foundation_duplicate' },
        { id: 'refund-b', provider: 'Stripe', providerRefundId: 're_foundation_duplicate' }
      ]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicateProviderRefund).map(conflict => conflict.kind), ['provider_refund:stripe'], 'One provider refund must never settle two local refund requests.');
    const providerScopedRefundIds = {
      refundRequests: [
        { id: 'refund-stripe', paymentProvider: 'stripe', providerRefundId: 'shared-provider-value' },
        { id: 'refund-clover', paymentProvider: 'clover', providerRefundId: 'shared-provider-value' }
      ]
    };
    assert.strictEqual(stateRepository.identityConflicts(providerScopedRefundIds).length, 0, 'Different payment providers may issue the same refund identifier without creating a false cross-provider conflict.');
    const sharedStripeCardAcrossPlans = {
      recurringPayments: [
        { id: 'shared-card-plan-a', stripeCustomerId: 'cus_shared', stripePaymentMethodId: 'pm_shared', stripeSubscriptionId: 'sub_shared_a' },
        { id: 'shared-card-plan-b', stripeCustomerId: 'cus_shared', stripePaymentMethodId: 'pm_shared', stripeSubscriptionId: 'sub_shared_b' }
      ]
    };
    assert.strictEqual(stateRepository.identityConflicts(sharedStripeCardAcrossPlans).length, 0, 'A customer may intentionally authorize one Stripe card for multiple distinct recurring plans.');
    const duplicatePrivateDocumentIdentity = {
      documents: [{ id: 'private-artifact-duplicate', storageKey: 'documents/private-artifact-duplicate.enc' }],
      eSignatures: [{ id: 'private-artifact-duplicate', storageKey: 'signatures/private-artifact-duplicate.enc' }]
    };
    assert.deepStrictEqual(stateRepository.identityConflicts(duplicatePrivateDocumentIdentity).map(conflict => conflict.kind), ['private_document_id'], 'A private document and e-signature must never share one database document identity.');
    const missingVinWarnings = stateRepository.identityWarnings({ vehicles: [{ id: 'vehicle-missing-vin', year: 2013, make: 'BMW', model: '528XI', plate: 'VIN-REVIEW', tracker: 'Tracker 12', currentCustomer: 'VIN Review Customer', status: 'Rented' }] });
    assert.strictEqual(missingVinWarnings.length, 1, 'A vehicle without a VIN must remain visible for owner review before Stripe cutover.');
    assert.strictEqual(missingVinWarnings[0].kind, 'vehicle_missing_vin', 'A missing VIN warning must retain a stable review category.');
    assert.deepStrictEqual({ plate: missingVinWarnings[0].plate, tracker: missingVinWarnings[0].tracker, customer: missingVinWarnings[0].customer, status: missingVinWarnings[0].status }, { plate: 'VIN-REVIEW', tracker: 'Tracker 12', customer: 'VIN Review Customer', status: 'Rented' }, 'A VIN review warning must identify the tag, tracker, assigned customer, and fleet status needed to find the physical vehicle.');
    assert.strictEqual(stateRepository.identityWarnings({ vehicles: [{ id: 'application-placeholder', year: 'test', make: 'test', status: 'Pending application' }] }).length, 0, 'A pending application placeholder must not be treated as an operational fleet VIN blocker.');

    const indexedBusinessState = {
      vehicles: [{ id: 'vehicle-index-1', vin: 'INDEXVIN000000001', status: 'Rented', currentCustomer: 'Maya Stone' }],
      customers: [{ id: 'customer-index-1', name: 'Maya Stone', vehicleId: 'vehicle-index-1', status: 'Active' }],
      contracts: [{ id: 'file-index-1', customer: 'Maya R Stone', vehicleId: 'vehicle-index-1', status: 'Active' }],
      recurringPayments: [{ id: 'recurring-index-1', customer: 'Maya Stone', vehicleId: 'vehicle-index-1', status: 'Active' }],
      payments: [{ id: 'payment-index-1', customer: 'Maya Stone', vehicleId: 'vehicle-index-1', status: 'Paid' }]
    };
    const resourceIndexRows = stateRepository.criticalResourceIndexRows(indexedBusinessState);
    assert.strictEqual(resourceIndexRows.length, 5, 'The PostgreSQL resource index must include the vehicle, customer, customer file, autopay row, and payment record.');
    assert(resourceIndexRows.some(row => row.resourceType === 'customer_file' && row.resourceId === 'file-index-1' && row.vehicleId === 'vehicle-index-1'), 'A customer file index row must retain its stable file id and vehicle link.');
    assert.throws(
      () => stateRepository.criticalResourceIndexRows({ customers: [{ name: 'Missing Stable Id' }] }),
      error => error && error.code === 'woa_resource_identity_missing',
      'A critical record without a stable id must fail before a PostgreSQL state transaction commits.'
    );
    assert.throws(
      () => stateRepository.criticalResourceIndexRows({ contracts: [{ id: 'duplicate-file' }, { id: 'duplicate-file' }] }),
      error => error && error.code === 'woa_resource_identity_conflict',
      'Duplicate customer-file ids must fail before a PostgreSQL state transaction commits.'
    );
    const activeAssignments = stateRepository.activeAssignmentIndexRows(indexedBusinessState);
    assert.strictEqual(activeAssignments.length, 1, 'Matching active customer, file, and autopay rows must collapse into one vehicle assignment.');
    assert.strictEqual(activeAssignments[0].customerName, 'Maya Stone', 'The active assignment index must retain the canonical saved customer name.');
    assert.strictEqual(activeAssignments[0].sourceRefs.length, 3, 'The active assignment must preserve each authoritative source for later recovery review.');
    const exactIndexReadiness = stateRepository.transactionalIndexReadiness(indexedBusinessState, {
      resourceIndexCount: resourceIndexRows.length,
      assignmentIndexCount: activeAssignments.length,
      identityIndexCount: stateRepository.identityEntries(indexedBusinessState).length,
      documentIndexCount: stateRepository.privateDocumentRows(indexedBusinessState).length
    });
    assert.strictEqual(exactIndexReadiness.allReady, true, 'PostgreSQL readiness must require all four transactional indexes to match authoritative state.');
    const missingProviderIdentityIndex = stateRepository.transactionalIndexReadiness(indexedBusinessState, {
      resourceIndexCount: resourceIndexRows.length,
      assignmentIndexCount: activeAssignments.length,
      identityIndexCount: Math.max(0, exactIndexReadiness.expectedIdentityIndexCount - 1),
      documentIndexCount: exactIndexReadiness.expectedDocumentIndexCount
    });
    assert.strictEqual(missingProviderIdentityIndex.allReady, false, 'A missing immutable provider identity row must block PostgreSQL production readiness.');
    assert.strictEqual(missingProviderIdentityIndex.identityIndexReady, false, 'The launch gate must identify provider-identity index drift directly.');
    const orphanedDocumentIndex = stateRepository.transactionalIndexReadiness(indexedBusinessState, {
      resourceIndexCount: resourceIndexRows.length,
      assignmentIndexCount: activeAssignments.length,
      identityIndexCount: exactIndexReadiness.expectedIdentityIndexCount,
      documentIndexCount: exactIndexReadiness.expectedDocumentIndexCount + 1
    });
    assert.strictEqual(orphanedDocumentIndex.allReady, false, 'Orphaned private-document metadata must block PostgreSQL production readiness.');
    assert.strictEqual(orphanedDocumentIndex.documentIndexReady, false, 'The launch gate must identify private-document index drift directly.');
    assert.strictEqual(stateRepository.activeAssignmentIndexRows({
      vehicles: [{ id: 'vehicle-history', status: 'Ready', currentCustomer: 'Old Customer' }],
      customers: [{ id: 'customer-history', name: 'Old Customer', vehicleId: 'vehicle-history', status: 'History' }]
    }).length, 0, 'History rows and stale current-customer values on ready fleet cars must not create active assignments.');
    const correctedStaleVehicle = stateRepository.activeAssignmentIndexRows({
      vehicles: [{ id: 'vehicle-stale-name', status: 'Rented', currentCustomer: 'Previous Customer' }],
      customers: [{ id: 'customer-current', name: 'Current Customer', vehicleId: 'vehicle-stale-name', status: 'Active' }]
    });
    assert.strictEqual(correctedStaleVehicle[0].customerName, 'Current Customer', 'An authoritative active record must replace a stale vehicle current-customer fallback without creating a false conflict.');
    const approvedAliasAssignment = stateRepository.activeAssignmentIndexRows({
      vehicles: [{ id: 'vehicle-alias', status: 'Rented' }],
      customers: [{ id: 'customer-alias', name: 'Khaled Jazzar', vehicleId: 'vehicle-alias', status: 'Active' }],
      contracts: [{ id: 'file-alias', customer: 'KJ Holdings', vehicleId: 'vehicle-alias', status: 'Active' }],
      assignmentCustomerAliases: [{ id: 'alias-1', vehicleId: 'vehicle-alias', canonicalCustomer: 'Khaled Jazzar', aliasCustomer: 'KJ Holdings', active: true }]
    });
    assert.strictEqual(approvedAliasAssignment.length, 1, 'An explicitly approved customer alias must reconcile to one active vehicle assignment.');
    const cloverMirrorNameVariant = {
      vehicles: [{ id: 'vehicle-provider-mirror', status: 'Rented', currentCustomer: 'Alyssa leithead' }],
      customers: [{ id: 'customer-provider-mirror', name: 'Alyssa leithead', vehicleId: 'vehicle-provider-mirror', status: 'Active' }],
      contracts: [{ id: 'file-provider-mirror', customer: 'Alyssa leithead', vehicleId: 'vehicle-provider-mirror', status: 'Active' }],
      integrations: {
        clover: {
          recurringPlanMembers: [{
            id: 'clover-provider-mirror',
            customer: 'Alyssa Leitheas',
            vehicleId: 'vehicle-provider-mirror',
            status: 'Active',
            cloverSubscriptionId: 'clover-sub-provider-mirror'
          }]
        }
      }
    };
    assert.strictEqual(stateRepository.activeAssignmentIdentityConflicts(cloverMirrorNameVariant).length, 0, 'A Clover payment-plan mirror with an enriched vehicle and spelling variation must not become a second rental assignment.');
    const cloverMirrorAssignments = stateRepository.activeAssignmentIndexRows(cloverMirrorNameVariant);
    assert.strictEqual(cloverMirrorAssignments.length, 1, 'WheelsonAuto rental records must remain the sole assignment truth when a Clover provider mirror carries the same vehicle link.');
    assert.strictEqual(cloverMirrorAssignments[0].customerName, 'Alyssa leithead', 'The authoritative WheelsonAuto customer name must win over a Clover provider spelling variation.');
    assert(!cloverMirrorAssignments[0].sourceRefs.some(row => row.source === 'clover_recurring'), 'The transactional assignment index must not persist Clover payment-plan mirrors as fleet claims.');
    assert.throws(
      () => stateRepository.activeAssignmentIndexRows({
        vehicles: [{ id: 'vehicle-conflict', status: 'Rented' }],
        customers: [{ id: 'customer-a', name: 'Customer Alpha', vehicleId: 'vehicle-conflict', status: 'Active' }],
        contracts: [{ id: 'file-b', customer: 'Customer Beta', vehicleId: 'vehicle-conflict', status: 'Active' }]
      }),
      error => error && error.code === 'woa_assignment_identity_conflict',
      'Two active customers claiming the same vehicle must fail the entire database write.'
    );
    const enumeratedAssignmentConflicts = stateRepository.activeAssignmentIdentityConflicts({
      vehicles: [
        { id: 'vehicle-conflict-a', status: 'Rented' },
        { id: 'vehicle-conflict-b', status: 'Rented' }
      ],
      customers: [
        { id: 'customer-conflict-a1', name: 'Alex North', vehicleId: 'vehicle-conflict-a', status: 'Active' },
        { id: 'customer-conflict-a2', name: 'Jordan South', vehicleId: 'vehicle-conflict-a', status: 'Active' },
        { id: 'customer-conflict-b1', name: 'Taylor East', vehicleId: 'vehicle-conflict-b', status: 'Active' }
      ],
      contracts: [
        { id: 'file-conflict-b2', customer: 'Morgan West', vehicleId: 'vehicle-conflict-b', status: 'Active' }
      ]
    });
    assert.deepStrictEqual(enumeratedAssignmentConflicts.map(row => row.vehicleId), ['vehicle-conflict-a', 'vehicle-conflict-b'], 'The owner and PostgreSQL preflight must enumerate every transactional assignment conflict instead of stopping after the first vehicle.');
    assert.deepStrictEqual(enumeratedAssignmentConflicts.map(row => row.customers.length), [2, 2], 'Each transactional conflict must preserve the exact competing customer identities for owner review.');
    assert.throws(
      () => stateRepository.activeAssignmentIndexRows({
        vehicles: [{ id: 'vehicle-present', status: 'Ready' }],
        customers: [{ id: 'customer-missing-car', name: 'Missing Car Customer', vehicleId: 'vehicle-not-found', status: 'Active' }]
      }),
      error => error && error.code === 'woa_assignment_vehicle_missing',
      'An active customer record pointing to a missing vehicle must fail instead of silently disappearing from Fleet.'
    );

    const documentRoot = path.join(temp, 'private-documents');
    const foundationV1Key = Buffer.alloc(32, 9).toString('base64');
    const store = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: foundationV1Key,
      keyVersion: 'test-v1'
    });
    const source = Buffer.from('private identity proof must never be written in clear text', 'utf8');
    const stored = await store.save({
      id: 'doc-foundation-1',
      bytes: source,
      contentType: 'application/pdf',
      originalName: 'identity.pdf',
      organizationId: 'org-test'
    });
    const encrypted = await fs.readFile(path.join(temp, stored.storagePath));
    assert(!encrypted.equals(source), 'Private document bytes must be encrypted at rest.');
    assert.strictEqual(stored.organizationId, 'org-test', 'Encrypted document metadata must retain its owning organization.');
    assert((await store.read(stored)).equals(source), 'Encrypted private document reads must restore the original bytes.');
    await assert.rejects(() => store.read({ ...stored, encryption: { ...stored.encryption, authTag: Buffer.alloc(16).toString('base64') } }), /authenticate|Unsupported state|unable/i, 'Tampered encrypted document metadata must not decrypt.');
    await assert.rejects(() => store.read({ ...stored, organizationId: 'org-other-company' }), /ownership metadata/i, 'Moving a private document record into another company must fail authenticated ownership verification.');
    await assert.rejects(() => store.read({ ...stored, id: 'doc-other-customer' }), /ownership metadata/i, 'Relabeling a private document as another customer record must fail authenticated identity verification.');
    await assert.rejects(() => store.read({ ...stored, contentType: 'image/png' }), /ownership metadata/i, 'Changing the authenticated private document type must fail closed.');
    const rotatedStore = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-v2',
      decryptionKeys: { 'test-v1': foundationV1Key }
    });
    assert((await rotatedStore.read(stored)).equals(source), 'A rotated document store must keep older private files readable through their versioned decryption key.');
    assert.deepStrictEqual(rotatedStore.status().availableKeyVersions, ['test-v1', 'test-v2'], 'Private storage readiness may expose key versions, but never key material, for recovery review.');
    const missingHistoricalKeyStore = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-v2'
    });
    await assert.rejects(() => missingHistoricalKeyStore.read(stored), /key version test-v1 is not configured/i, 'A missing historical key must fail with an actionable recovery message instead of corrupting or replacing the file.');
    assert.throws(() => secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-v2',
      decryptionKeys: { 'test-v2': Buffer.alloc(32, 11).toString('base64') }
    }), /conflicts/i, 'The active key version must not silently conflict with the recovery keyring.');
    const storageProbe = await store.probe({ organizationId: 'org-test' });
    assert(storageProbe.ok && storageProbe.encrypted && storageProbe.objectDeleted, 'Private document storage validation must prove encrypted write, read, and cleanup.');

    const s3Objects = new Map();
    const storageResponse = (status, bytes = Buffer.alloc(0)) => ({
      ok: status >= 200 && status < 300,
      status,
      async arrayBuffer() {
        const body = Buffer.from(bytes);
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      }
    });
    const privateS3Fetch = async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const headers = options.headers || {};
      const authorized = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
      const objectKey = new URL(url).pathname;
      if (!authorized) return storageResponse(403);
      if (method === 'PUT') {
        const writeOnce = Object.entries(headers).some(([key, value]) => key.toLowerCase() === 'if-none-match' && value === '*');
        if (writeOnce && s3Objects.has(objectKey)) return storageResponse(412);
        s3Objects.set(objectKey, Buffer.from(options.body || Buffer.alloc(0)));
        return storageResponse(200);
      }
      if (method === 'GET') return s3Objects.has(objectKey) ? storageResponse(200, s3Objects.get(objectKey)) : storageResponse(404);
      if (method === 'DELETE') {
        s3Objects.delete(objectKey);
        return storageResponse(204);
      }
      return storageResponse(405);
    };
    const privateS3Store = secureDocumentStore.createSecureDocumentStore({
      provider: 's3',
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-s3-v1',
      bucket: 'wheelsonauto-private-test',
      endpoint: 'https://objects.example.test',
      region: 'auto',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      pathStyle: true,
      fetch: privateS3Fetch
    });
    assert(privateS3Store.status().productionReady && privateS3Store.status().secureTransport, 'Production private storage must require a complete S3 configuration over HTTPS.');
    await privateS3Store.writeObject('immutability-check/object.bin', Buffer.from('original encrypted object'));
    await assert.rejects(
      () => privateS3Store.writeObject('immutability-check/object.bin', Buffer.from('replacement encrypted object')),
      error => error && error.code === 'private_object_already_exists' && error.statusCode === 412,
      'S3-compatible writes must use a conditional write and fail closed instead of overwriting an immutable encrypted object.'
    );
    assert.strictEqual((await privateS3Store.readObject('immutability-check/object.bin')).toString('utf8'), 'original encrypted object', 'A rejected S3 collision must preserve the original encrypted object.');
    await privateS3Store.deleteObject('immutability-check/object.bin');
    const privateS3Probe = await privateS3Store.probe({ organizationId: 'org-test-s3' });
    assert(privateS3Probe.ok && privateS3Probe.publicReadBlocked === true && privateS3Probe.objectDeleted, 'The production storage probe must prove anonymous reads are blocked before deleting its encrypted object.');
    const privateS3Backups = encryptedStateBackup.createEncryptedStateBackupStore({
      objectStore: privateS3Store,
      organizationId: 'org-test-s3',
      encryptionKey: Buffer.alloc(32, 13).toString('base64'),
      keyVersion: 'backup-s3-v1'
    });
    assert(privateS3Backups.status().productionReady, 'Encrypted state backups must recognize the same private HTTPS S3-compatible transport as production-ready.');
    const privateS3Backup = await privateS3Backups.create({ vehicles: [{ id: 's3-backup-vehicle' }], payments: [] }, { stateVersion: 3 });
    assert(privateS3Backup.verified && (await privateS3Backups.verifyLatest()).stateChecksum === privateS3Backup.stateChecksum, 'The S3-compatible backup path must write, atomically publish, read, decrypt, and authenticate the captured state.');
    await privateS3Store.deleteObject(privateS3Backup.storageKey);
    await privateS3Store.deleteObject(privateS3Backups.latestPointerKey());
    const publicS3Store = secureDocumentStore.createSecureDocumentStore({
      provider: 's3',
      encryptionKey: Buffer.alloc(32, 11).toString('base64'),
      keyVersion: 'test-s3-public-v1',
      bucket: 'wheelsonauto-public-test',
      endpoint: 'https://objects.example.test',
      region: 'auto',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      pathStyle: true,
      fetch: async (url, options = {}) => {
        const headers = options.headers || {};
        const authorized = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
        if (!authorized && String(options.method || 'GET').toUpperCase() === 'GET') return storageResponse(200, Buffer.from('public encrypted object'));
        return privateS3Fetch(url, options);
      }
    });
    await assert.rejects(() => publicS3Store.probe({ organizationId: 'org-test-public-s3' }), /publicly readable/i, 'A bucket that permits anonymous reads must fail the launch proof and clean up its probe object.');
    assert.strictEqual(s3Objects.size, 0, 'Both successful and rejected storage probes must remove their temporary objects.');
    const insecureS3Store = secureDocumentStore.createSecureDocumentStore({
      provider: 's3',
      encryptionKey: Buffer.alloc(32, 12).toString('base64'),
      bucket: 'wheelsonauto-insecure-test',
      endpoint: 'http://objects.example.test',
      region: 'auto',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      pathStyle: true,
      fetch: privateS3Fetch
    });
    assert.strictEqual(insecureS3Store.status().productionReady, false, 'An HTTP object-storage endpoint must never report production-ready.');
    assert.match(insecureS3Store.status().message, /HTTPS endpoint/i, 'The storage readiness message must explain the secure-transport requirement.');

    const recurring = {
      id: 'rec-foundation-1',
      paymentProvider: 'clover',
      cloverCustomerId: 'clover-foundation',
      cloverPaymentSource: 'source-foundation',
      stripeCustomerId: 'cus-foundation',
      stripePaymentMethodId: 'pm-foundation',
      stripeMigration: { state: stripeMigration.STATES.CLOVER_ACTIVE }
    };
    assert.throws(
      () => stripeMigration.transition({ ...recurring, stripeMigration: { state: stripeMigration.STATES.CLOVER_ACTIVE } }, stripeMigration.STATES.CLOVER_DISABLED, { at: '2026-07-17T09:59:00.000Z' }),
      error => error && error.code === 'invalid_stripe_migration_transition' && error.currentState === stripeMigration.STATES.CLOVER_ACTIVE,
      'The shared migration engine must reject a direct Clover-active to Clover-disabled state skip.'
    );
    let migration = stripeMigration.transition(recurring, stripeMigration.STATES.STRIPE_SETUP_SENT, { at: '2026-07-17T10:00:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-17'), true, 'Sending a Stripe setup link must not stop the existing Clover schedule.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'stripe', '2026-07-17'), false, 'Stripe must remain inactive while card setup is only pending.');
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.STRIPE_CARD_SAVED, { at: '2026-07-17T10:01:00.000Z', cardSavedAt: '2026-07-17T10:01:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-17'), true, 'Saving a Stripe card must not stop Clover before a protected cutover.');
    assert.throws(
      () => stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.CUTOVER_SCHEDULED, { at: '2026-07-17T10:02:00.000Z', cutoverDate: '2026-07-24' }),
      error => error && error.code === 'invalid_stripe_migration_transition' && /exact Clover subscription ID/i.test(error.message || ''),
      'A cutover without an immutable Clover subscription binding must fail closed.'
    );
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.CUTOVER_SCHEDULED, { at: '2026-07-17T10:02:00.000Z', cutoverDate: '2026-07-24', scheduledCloverSubscriptionId: 'clover-sub-foundation' });
    assert.strictEqual(migration.scheduledCloverSubscriptionId, 'clover-sub-foundation', 'The migration record must preserve the exact Clover subscription bound at scheduling time.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-23'), true, 'Clover must remain chargeable for billing periods before the scheduled cutover.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-24'), false, 'A scheduled cutover must lock automatic Clover charging.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-25'), false, 'Clover must remain locked after the scheduled cutover date.');
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.FIRST_STRIPE_CHARGE_PENDING, { at: '2026-07-24T17:55:00.000Z', cutoverDate: '2026-07-24', cloverStoppedConfirmedAt: '2026-07-24T17:55:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, 'stripe', '2026-07-24'), true, 'A confirmed same-day cutover may allow the protected first Stripe charge.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, 'stripe', '2026-07-23'), false, 'The first Stripe charge must not run for a billing date before the protected cutover.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: { ...migration, cutoverDate: '' } }, 'stripe', '2026-07-24'), false, 'A Clover-to-Stripe first charge without a saved cutover date must fail closed.');
    assert.throws(
      () => stripeMigration.transition({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, stripeMigration.STATES.CLOVER_DISABLED, { at: '2026-07-24T18:00:00.000Z' }),
      error => error && error.code === 'invalid_stripe_migration_transition',
      'The shared migration engine must not mark Clover disabled before the verified first Stripe charge passes.'
    );
    assert.throws(
      () => stripeMigration.transition({
        ...recurring,
        paymentProvider: 'stripe',
        stripeMigration: {
          ...migration,
          cloverStoppedConfirmedAt: '',
          state: stripeMigration.STATES.FIRST_STRIPE_CHARGE_PENDING
        }
      }, stripeMigration.STATES.FIRST_STRIPE_CHARGE_PASSED, {
        at: '2026-07-24T18:00:00.000Z',
        firstStripeChargeAt: '2026-07-24T18:00:00.000Z',
        firstStripePaymentIntentId: 'pi-corrupt-missing-stop-proof'
      }),
      error => error && error.code === 'invalid_stripe_migration_transition' && /owner Clover-stop confirmation/i.test(error.message || ''),
      'A repaired or corrupted pending row must not inherit missing Clover-stop proof and advance from a Stripe webhook.'
    );
    assert.throws(
      () => stripeMigration.transition({
        ...recurring,
        paymentProvider: 'stripe',
        stripeMigration: {
          ...migration,
          scheduledCloverSubscriptionId: '',
          state: stripeMigration.STATES.FIRST_STRIPE_CHARGE_PASSED,
          firstStripeChargeAt: '2026-07-24T18:00:00.000Z',
          firstStripePaymentIntentId: 'pi-corrupt-missing-plan-binding'
        }
      }, stripeMigration.STATES.CLOVER_DISABLED, {
        at: '2026-07-24T18:00:01.000Z',
        cloverDisabledAt: '2026-07-24T18:00:01.000Z'
      }),
      error => error && error.code === 'invalid_stripe_migration_transition' && /exact Clover subscription binding/i.test(error.message || ''),
      'A repaired or corrupted paid row must not disable Clover without the exact scheduled subscription binding.'
    );
    migration = stripeMigration.transition({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, stripeMigration.STATES.FIRST_STRIPE_CHARGE_PASSED, {
      at: '2026-07-24T18:00:00.000Z',
      firstStripeChargeAt: '2026-07-24T18:00:00.000Z',
      firstStripePaymentIntentId: 'pi-foundation-first-charge'
    });
    migration = stripeMigration.transition({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, stripeMigration.STATES.CLOVER_DISABLED, {
      at: '2026-07-24T18:00:01.000Z',
      cloverDisabledAt: '2026-07-24T18:00:01.000Z',
      cloverDisabledBy: 'Foundation owner'
    });
    assert.strictEqual(migration.state, stripeMigration.STATES.CLOVER_DISABLED, 'The complete evidence-backed transition sequence must reach Clover disabled.');
    assert.throws(
      () => stripeMigration.rollbackToClover({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, { at: '2026-07-24T18:05:00.000Z' }),
      error => error && error.code === 'invalid_stripe_migration_transition',
      'Returning a Stripe-active customer to Clover must require explicit confirmation that Stripe stopped.'
    );
    const rolledBack = stripeMigration.rollbackToClover({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, {
      at: '2026-07-24T18:05:00.000Z',
      stripeStoppedConfirmedAt: '2026-07-24T18:05:00.000Z',
      by: 'Foundation owner'
    });
    assert.strictEqual(rolledBack.state, stripeMigration.STATES.STRIPE_CARD_SAVED, 'A confirmed return to Clover must preserve the saved Stripe card without leaving an active cutover.');
    assert.strictEqual(rolledBack.cutoverDate, '', 'A confirmed return to Clover must clear the active cutover date.');
    assert.strictEqual(rolledBack.firstStripeChargeAt, '', 'A confirmed return to Clover must not leave the prior first Stripe charge attached to a future cutover cycle.');
    assert.strictEqual(rolledBack.firstStripePaymentIntentId, '', 'A confirmed return to Clover must clear the prior active-cycle PaymentIntent reference.');
    assert.strictEqual(rolledBack.cloverDisabledAt, '', 'A confirmed return to Clover must not keep showing Clover as disabled in the active migration cycle.');
    assert.strictEqual(rolledBack.closedCutovers.length, 1, 'A confirmed return to Clover must archive the completed cutover before clearing active fields.');
    assert.strictEqual(rolledBack.closedCutovers[0].firstStripePaymentIntentId, 'pi-foundation-first-charge', 'The closed cutover audit must preserve its exact first Stripe PaymentIntent.');
    assert.strictEqual(rolledBack.closedCutovers[0].scheduledCloverSubscriptionId, 'clover-sub-foundation', 'The closed cutover audit must preserve its exact Clover subscription binding.');
    assert.strictEqual(rolledBack.closedCutovers[0].rolledBackBy, 'Foundation owner', 'The closed cutover audit must preserve the owner who confirmed the rollback.');
    const restartedRollback = stripeMigration.migrationRecord({ ...recurring, paymentProvider: 'clover', stripeMigration: rolledBack });
    assert.deepStrictEqual(restartedRollback.closedCutovers, rolledBack.closedCutovers, 'Closed cutover evidence must survive a server restart without reactivating stale migration fields.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: { state: stripeMigration.STATES.CLOVER_ACTIVE } }, 'stripe', '2026-07-24'), false, 'An inconsistent Stripe-provider row that is still Clover-active must fail closed.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'clover', stripeMigration: { state: stripeMigration.STATES.CLOVER_DISABLED } }, 'clover', '2026-07-24'), false, 'An inconsistent Clover-provider row marked Clover-disabled must fail closed.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: { state: stripeMigration.STATES.STRIPE_ACTIVE } }, 'stripe', '2026-07-24'), true, 'A consistent Stripe-active row may use Stripe autopay.');

    const periodState = { payments: [{ id: 'paid-clover-period', recurringPaymentId: recurring.id, paymentProvider: 'clover', billingPeriodKey: 'due:2026-07-24', status: 'Paid' }] };
    assert.throws(() => stripeMigration.assertBillingPeriodOpen(periodState, recurring, '2026-07-24'), /duplicate charge/i, 'A Stripe charge must be blocked when Clover already paid the same billing period.');
    assert.strictEqual(stripeMigration.existingPaidPayment(periodState, recurring, '2026-07-24').id, 'paid-clover-period', 'Cross-provider period lookup must retain the original payment record.');
    assert.strictEqual(stripeMigration.existingBillingPeriodPayment(periodState, { ...recurring, frequency: 'Weekly' }, '2026-07-25').id, 'paid-clover-period', 'A paid weekly billing period must remain protected when its due date is shifted by one day inside the same week.');
    assert.throws(() => stripeMigration.assertBillingPeriodOpen(periodState, { ...recurring, frequency: 'Weekly' }, '2026-07-30'), /duplicate charge/i, 'The day before the next weekly occurrence must remain protected from a schedule-edit duplicate.');
    assert.strictEqual(stripeMigration.existingBillingPeriodPayment(periodState, { ...recurring, frequency: 'Weekly' }, '2026-07-31'), null, 'The next exact weekly occurrence must open a new billing period.');
    const dailyPeriodState = { payments: [{ id: 'paid-daily-period', recurringPaymentId: recurring.id, billingPeriodKey: 'due:2026-07-24', frequency: 'Daily', status: 'Paid' }] };
    assert.strictEqual(stripeMigration.existingBillingPeriodPayment(dailyPeriodState, { ...recurring, frequency: 'Daily' }, '2026-07-25'), null, 'A daily plan must open on the next calendar day instead of inheriting the weekly window.');
    const monthlyPeriodState = { payments: [{ id: 'paid-monthly-period', recurringPaymentId: recurring.id, scheduledDueDate: '2026-01-31', billingPeriodKey: 'due:2026-01-31', frequency: 'Monthly', monthlyDay: 31, status: 'Paid' }] };
    assert.strictEqual(stripeMigration.existingBillingPeriodPayment(monthlyPeriodState, { ...recurring, frequency: 'Monthly', monthlyDay: 31 }, '2026-02-27').id, 'paid-monthly-period', 'A monthly payment must protect the complete calendar billing window.');
    assert.strictEqual(stripeMigration.existingBillingPeriodPayment(monthlyPeriodState, { ...recurring, frequency: 'Monthly', monthlyDay: 31 }, '2026-02-28'), null, 'A month-end plan must open on its correctly clamped next occurrence.');
    const unverifiedOutsidePeriod = { payments: [{ id: 'unverified-outside-period', recurringPaymentId: recurring.id, billingPeriodKey: 'due:2026-07-24', status: 'Paid outside app - needs verification' }] };
    assert.strictEqual(stripeMigration.existingBillingPeriodPayment(unverifiedOutsidePeriod, recurring, '2026-07-24'), null, 'A customer-reported outside payment must not block or satisfy the billing period before owner verification.');
    assert.strictEqual(stripeMigration.assertBillingPeriodOpen(unverifiedOutsidePeriod, recurring, '2026-07-24'), null, 'An unverified outside-payment claim must not let a customer pause scheduled autopay merely by submitting the form.');
    ['Processing', 'Confirmation pending', 'Refunded', 'Partially refunded', 'Disputed', 'Chargeback'].forEach(status => {
      const protectedPeriod = { payments: [{ id: 'protected-' + status.toLowerCase().replace(/\s+/g, '-'), recurringPaymentId: recurring.id, billingPeriodKey: 'due:2026-07-25', status }] };
      assert.throws(() => stripeMigration.assertBillingPeriodOpen(protectedPeriod, recurring, '2026-07-25'), /duplicate charge/i, status + ' must keep the billing period closed until an owner deliberately reviews it.');
      assert.strictEqual(stripeMigration.existingPaidPayment(protectedPeriod, recurring, '2026-07-25'), null, status + ' must not masquerade as verified successful-payment evidence.');
      assert.strictEqual(stripeMigration.existingBillingPeriodPayment(protectedPeriod, recurring, '2026-07-25').status, status, status + ' must remain visible as duplicate-charge protection evidence.');
    });
    ['1x failed - retrying', 'Declined', 'Payment not found - check Clover', 'Voided', 'Stripe card authentication required'].forEach(status => {
      const retryablePeriod = { payments: [{ id: 'retryable-' + status.toLowerCase().replace(/\s+/g, '-'), recurringPaymentId: recurring.id, billingPeriodKey: 'due:2026-07-26', status }] };
      assert.strictEqual(stripeMigration.assertBillingPeriodOpen(retryablePeriod, recurring, '2026-07-26'), null, status + ' must remain eligible for the controlled retry or card-recovery workflow.');
    });
    const refundedPeriod = { payments: [{ id: 'owner-reviewed-refund', recurringPaymentId: recurring.id, billingPeriodKey: 'due:2026-07-27', status: 'Refunded' }] };
    assert.strictEqual(stripeMigration.assertBillingPeriodOpen(refundedPeriod, recurring, '2026-07-27', { allowAdditionalManualCharge: true }).id, 'owner-reviewed-refund', 'Only an explicit owner-reviewed additional manual charge may override a protected billing period.');

    const sharedCustomerPlanA = { ...recurring, id: 'rec-shared-plan-a', cloverCustomerId: 'clover-shared-customer', cloverSubscriptionId: 'clover-subscription-a', stripeCustomerId: 'stripe-shared-customer' };
    const sharedCustomerPlanB = { ...recurring, id: 'rec-shared-plan-b', cloverCustomerId: 'clover-shared-customer', cloverSubscriptionId: 'clover-subscription-b', stripeCustomerId: 'stripe-shared-customer' };
    const sharedCustomerPayments = {
      payments: [{
        id: 'paid-shared-plan-a',
        recurringPaymentId: sharedCustomerPlanA.id,
        cloverSubscriptionId: sharedCustomerPlanA.cloverSubscriptionId,
        cloverCustomerId: sharedCustomerPlanA.cloverCustomerId,
        stripeCustomerId: sharedCustomerPlanA.stripeCustomerId,
        billingPeriodKey: 'due:2026-07-24',
        status: 'Paid'
      }]
    };
    assert.strictEqual(stripeMigration.existingPaidPayment(sharedCustomerPayments, sharedCustomerPlanA, '2026-07-24').id, 'paid-shared-plan-a', 'Exact recurring and Clover subscription IDs must match the paid plan.');
    assert.strictEqual(stripeMigration.existingPaidPayment(sharedCustomerPayments, sharedCustomerPlanB, '2026-07-24'), null, 'A payment for plan A must not fall back to the shared customer ID and block or complete plan B.');
    const mismatchedPlanPayment = { ...sharedCustomerPayments.payments[0], recurringPaymentId: sharedCustomerPlanB.id, cloverSubscriptionId: sharedCustomerPlanA.cloverSubscriptionId };
    assert.strictEqual(stripeMigration.paymentLinkedToRecurring(mismatchedPlanPayment, sharedCustomerPlanA), false, 'Conflicting explicit recurring and subscription IDs must fail closed instead of trusting one matching field.');
    assert.strictEqual(stripeMigration.paymentLinkedToRecurring(mismatchedPlanPayment, sharedCustomerPlanB), false, 'Conflicting explicit recurring and subscription IDs must never fall back to a shared provider customer ID.');
    const unscopedSharedCustomerPayment = { id: 'paid-shared-unscoped', cloverCustomerId: sharedCustomerPlanA.cloverCustomerId, billingPeriodKey: 'due:2026-07-24', status: 'Paid' };
    assert.strictEqual(stripeMigration.paymentLinkedToRecurring(unscopedSharedCustomerPayment, sharedCustomerPlanA), true, 'A provider payment without a plan identifier must remain visible as ambiguous same-customer evidence instead of being silently ignored.');
    assert.strictEqual(stripeMigration.paymentLinkedToRecurring(unscopedSharedCustomerPayment, sharedCustomerPlanB), true, 'Ambiguous same-customer evidence must block guessing across every potentially matching plan until staff links the exact transaction.');

    console.log('Production foundation check passed: atomic state fallback, durable money-action idempotency, migration-proof guard, checksum fail-closed behavior, controlled recovery-drill evidence, immutable identity preflight, encrypted private storage, tamper rejection, reviewable background monitoring, Star request caps, durable job-lock contract, and Clover-to-Stripe duplicate protection are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
