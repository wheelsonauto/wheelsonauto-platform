'use strict';

const STATES = Object.freeze({
  CLOVER_ACTIVE: 'clover_active',
  STRIPE_SETUP_SENT: 'stripe_setup_sent',
  STRIPE_CARD_SAVED: 'stripe_card_saved',
  CUTOVER_SCHEDULED: 'cutover_scheduled',
  FIRST_STRIPE_CHARGE_PENDING: 'first_stripe_charge_pending',
  FIRST_STRIPE_CHARGE_PASSED: 'first_stripe_charge_passed',
  CLOVER_DISABLED: 'clover_disabled',
  STRIPE_ACTIVE: 'stripe_active'
});

const FORWARD_TRANSITIONS = Object.freeze({
  [STATES.CLOVER_ACTIVE]: Object.freeze([STATES.STRIPE_SETUP_SENT, STATES.STRIPE_CARD_SAVED]),
  [STATES.STRIPE_SETUP_SENT]: Object.freeze([STATES.STRIPE_CARD_SAVED]),
  [STATES.STRIPE_CARD_SAVED]: Object.freeze([STATES.CUTOVER_SCHEDULED]),
  [STATES.CUTOVER_SCHEDULED]: Object.freeze([STATES.FIRST_STRIPE_CHARGE_PENDING]),
  [STATES.FIRST_STRIPE_CHARGE_PENDING]: Object.freeze([STATES.FIRST_STRIPE_CHARGE_PASSED]),
  [STATES.FIRST_STRIPE_CHARGE_PASSED]: Object.freeze([STATES.CLOVER_DISABLED]),
  [STATES.CLOVER_DISABLED]: Object.freeze([STATES.STRIPE_ACTIVE]),
  [STATES.STRIPE_ACTIVE]: Object.freeze([])
});

function text(value) {
  return String(value || '').trim();
}

function provider(value) {
  const normalized = text(value).toLowerCase();
  return normalized.includes('stripe') ? 'stripe' : 'clover';
}

function validDateKey(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function paymentIsPaid(value) {
  const status = text(value).toLowerCase();
  return !!status && !/(fail|declin|void|refund|dispute|not found|rejected|cancel|needs verification|awaiting verification)/.test(status) && (/^paid\b/.test(status) || /succeed|success|captur|complete/.test(status));
}

function paymentConsumesBillingPeriod(value) {
  const status = text(value).toLowerCase();
  if (!status) return false;
  if (paymentIsPaid(status)) return true;
  if (/(refund|dispute|chargeback|retrieval)/.test(status)) return true;
  return /(pending|processing|requesting|confirmation pending|in progress|requires[_ -]?capture|authori[sz]ed)/.test(status);
}

function hasCloverSource(row = {}) {
  return !!(text(row.cloverSubscriptionId) || text(row.cloverPaymentSource) || text(row.cloverCustomerId));
}

function hasStripeCard(row = {}) {
  return !!(text(row.stripeCustomerId) && text(row.stripePaymentMethodId));
}

function activeCutoverRow(row = {}) {
  return !/(removed|returned|history|archived|ended|inactive|cancelled|canceled|expired|disabled)/.test(text(row.status).toLowerCase());
}

function resolvedCustomerName(row = {}) {
  const name = text(row.customer || row.customerName || row.fullName || row.name);
  if (!name || /^(clover recurring customer|unknown customer|unmatched clover payment)$/i.test(name)) return '';
  return name;
}

function cloverSubscriptionId(row = {}) {
  return text(row.cloverSubscriptionId || row.subscriptionId);
}

function verifiedCloverRosterSubscriptionIds(data = {}) {
  const clover = data && data.integrations && data.integrations.clover || {};
  return Array.from(new Set((Array.isArray(clover.lastRecurringVerifiedSubscriptionIds) ? clover.lastRecurringVerifiedSubscriptionIds : [])
    .map(value => text(value))
    .filter(Boolean)));
}

function cutoverEligibility(data = {}, row = {}, options = {}) {
  const currentProvider = provider(row.paymentProvider || row.provider || 'clover');
  if (currentProvider !== 'clover' || !hasCloverSource(row) || !activeCutoverRow(row)) {
    return {
      applicable: false,
      eligible: true,
      code: 'not_clover_cutover',
      message: 'This record does not require a Clover-to-Stripe cutover.'
    };
  }

  const subscriptionId = cloverSubscriptionId(row);
  if (!subscriptionId) {
    return {
      applicable: true,
      eligible: false,
      code: 'missing_clover_subscription_id',
      message: 'This customer stays on Clover until the exact Clover subscription ID is linked. WheelsonAuto will not guess which recurring plan to stop.'
    };
  }

  const activeRows = (Array.isArray(data.recurringPayments) ? data.recurringPayments : [])
    .filter(candidate => activeCutoverRow(candidate) && provider(candidate.paymentProvider || candidate.provider || 'clover') === 'clover' && hasCloverSource(candidate));
  const duplicateRows = activeRows.filter(candidate => cloverSubscriptionId(candidate) === subscriptionId);
  if (duplicateRows.length > 1) {
    return {
      applicable: true,
      eligible: false,
      code: 'duplicate_clover_subscription_id',
      subscriptionId,
      duplicateRows: duplicateRows.length,
      message: 'More than one active WheelsonAuto record uses this Clover subscription ID. Resolve the duplicate before scheduling a Stripe cutover.'
    };
  }

  const verifiedRosterIds = verifiedCloverRosterSubscriptionIds(data);
  if (options.requireProviderRoster !== false && !verifiedRosterIds.length) {
    return {
      applicable: true,
      eligible: false,
      code: 'missing_verified_clover_roster',
      subscriptionId,
      message: 'This customer stays on Clover until a fresh provider roster confirms the exact subscription ID. Run Clover recurring sync after the current safety release; WheelsonAuto will not authorize a cutover from a browser-entered ID alone.'
    };
  }
  if (options.requireProviderRoster !== false && !verifiedRosterIds.includes(subscriptionId)) {
    return {
      applicable: true,
      eligible: false,
      code: 'clover_subscription_not_in_verified_roster',
      subscriptionId,
      verifiedRosterSubscriptions: verifiedRosterIds.length,
      message: 'Clover did not return this exact subscription ID in the last verified provider roster. Keep this row on Clover and resolve the subscription match before scheduling Stripe.'
    };
  }

  const customerName = resolvedCustomerName(row);
  const customerIdentity = text(row.cloverCustomerId || row.customerId || row.contractId) || customerName;
  if (!customerIdentity) {
    return {
      applicable: true,
      eligible: false,
      code: 'missing_customer_identity',
      subscriptionId,
      message: 'This Clover subscription has no verified customer identity. Link the customer file before scheduling a Stripe cutover.'
    };
  }

  const normalizedName = customerName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const siblingPlans = activeRows.filter(candidate => {
    if (candidate === row || cloverSubscriptionId(candidate) === subscriptionId) return false;
    const sameCloverCustomer = text(row.cloverCustomerId) && text(candidate.cloverCustomerId) === text(row.cloverCustomerId);
    const sameCustomerFile = text(row.customerId) && text(candidate.customerId) === text(row.customerId);
    const candidateName = resolvedCustomerName(candidate).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return !!(sameCloverCustomer || sameCustomerFile || (normalizedName && candidateName === normalizedName));
  });

  return {
    applicable: true,
    eligible: true,
    code: siblingPlans.length ? 'verified_multi_plan_customer' : 'verified_clover_subscription',
    subscriptionId,
    providerRosterMatched: options.requireProviderRoster === false ? false : true,
    customerIdentity: text(row.cloverCustomerId || row.customerId || row.contractId) ? 'linked customer ID' : 'resolved customer name',
    relatedPlanCount: siblingPlans.length + 1,
    message: siblingPlans.length
      ? 'This customer has ' + (siblingPlans.length + 1) + ' distinct Clover subscriptions. This exact plan is eligible for an individual protected cutover; the other plans remain unchanged.'
      : 'The exact Clover subscription and customer identity are verified for an individual protected cutover.'
  };
}

function migrationRecord(row = {}) {
  const source = row && typeof row.stripeMigration === 'object' && row.stripeMigration ? row.stripeMigration : {};
  let state = text(source.state).toLowerCase();
  if (!Object.values(STATES).includes(state)) {
    const legacy = text(row.stripeMigrationStatus).toLowerCase();
    if (/cutover scheduled/.test(legacy)) state = STATES.CUTOVER_SCHEDULED;
    else if (/first stripe charge/.test(legacy)) state = STATES.FIRST_STRIPE_CHARGE_PASSED;
    else if (/clover disabled/.test(legacy)) state = STATES.CLOVER_DISABLED;
    else if (/stripe card ready|owner switch required|clover remains active/.test(legacy)) state = STATES.STRIPE_CARD_SAVED;
    // A legacy row that says Stripe while still carrying a Clover vault or
    // subscription identifier is ambiguous. Treat it as card-ready but
    // cutover-blocked until an owner explicitly confirms Clover is stopped.
    // Pure Stripe rows without a Clover source can remain Stripe-active.
    else if (provider(row.paymentProvider || row.provider) === 'stripe') state = hasCloverSource(row) ? STATES.STRIPE_CARD_SAVED : STATES.STRIPE_ACTIVE;
    else if (hasCloverSource(row) && hasStripeCard(row)) state = STATES.STRIPE_CARD_SAVED;
    else state = STATES.CLOVER_ACTIVE;
  }
  return {
    state,
    history: Array.isArray(source.history) ? source.history.slice(-30) : [],
    closedCutovers: Array.isArray(source.closedCutovers) ? source.closedCutovers.slice(-10).map(record => ({
      state: text(record && record.state),
      cutoverDate: validDateKey(record && record.cutoverDate),
      scheduledCloverSubscriptionId: text(record && record.scheduledCloverSubscriptionId),
      cloverStoppedConfirmedAt: text(record && record.cloverStoppedConfirmedAt),
      cloverStoppedConfirmedBy: text(record && record.cloverStoppedConfirmedBy),
      firstStripeChargeAt: text(record && record.firstStripeChargeAt),
      firstStripePaymentIntentId: text(record && record.firstStripePaymentIntentId),
      firstStripeChargeFailedAt: text(record && record.firstStripeChargeFailedAt),
      firstStripeChargeFailureCount: Math.max(0, Number(record && record.firstStripeChargeFailureCount || 0) || 0),
      firstStripeChargeFailureIntentId: text(record && record.firstStripeChargeFailureIntentId),
      firstStripeChargeFailureError: text(record && record.firstStripeChargeFailureError).slice(0, 500),
      cloverDisabledAt: text(record && record.cloverDisabledAt),
      cloverDisabledBy: text(record && record.cloverDisabledBy),
      stripeStoppedConfirmedAt: text(record && record.stripeStoppedConfirmedAt),
      rolledBackAt: text(record && record.rolledBackAt),
      rolledBackBy: text(record && record.rolledBackBy)
    })) : [],
    setupSentAt: text(source.setupSentAt || row.stripeSetupSentAt),
    cardSavedAt: text(source.cardSavedAt || row.stripeCardSavedAt),
    cutoverDate: validDateKey(source.cutoverDate || row.stripeCutoverDate),
    cutoverScheduledAt: text(source.cutoverScheduledAt || row.stripeCutoverScheduledAt),
    scheduledCloverSubscriptionId: text(source.scheduledCloverSubscriptionId || row.stripeCutoverCloverSubscriptionId),
    cloverStoppedConfirmedAt: text(source.cloverStoppedConfirmedAt || row.cloverStoppedConfirmedAt),
    cloverStoppedConfirmedBy: text(source.cloverStoppedConfirmedBy || row.cloverStoppedConfirmedBy),
    firstStripeChargeAt: text(source.firstStripeChargeAt || row.firstStripeChargeAt),
    firstStripePaymentIntentId: text(source.firstStripePaymentIntentId || row.firstStripePaymentIntentId),
    firstStripeChargeFailedAt: text(source.firstStripeChargeFailedAt || row.firstStripeChargeFailedAt),
    firstStripeChargeFailureCount: Math.max(0, Number(source.firstStripeChargeFailureCount || row.firstStripeChargeFailureCount || 0) || 0),
    firstStripeChargeFailureIntentId: text(source.firstStripeChargeFailureIntentId || row.firstStripeChargeFailureIntentId),
    firstStripeChargeFailureError: text(source.firstStripeChargeFailureError || row.firstStripeChargeFailureError).slice(0, 500),
    cloverDisabledAt: text(source.cloverDisabledAt || row.cloverDisabledAt),
    cloverDisabledBy: text(source.cloverDisabledBy || row.cloverDisabledBy),
    lastBillingPeriodKey: text(source.lastBillingPeriodKey || row.lastBillingPeriodKey),
    updatedAt: text(source.updatedAt || row.updatedAt)
  };
}

function stateLabel(state) {
  const labels = {
    [STATES.CLOVER_ACTIVE]: 'Clover active',
    [STATES.STRIPE_SETUP_SENT]: 'Stripe setup sent - Clover remains active',
    [STATES.STRIPE_CARD_SAVED]: 'Stripe card saved - schedule cutover',
    [STATES.CUTOVER_SCHEDULED]: 'Cutover scheduled - charges locked until owner confirmation',
    [STATES.FIRST_STRIPE_CHARGE_PENDING]: 'Stripe cutover confirmed - first Stripe charge pending',
    [STATES.FIRST_STRIPE_CHARGE_PASSED]: 'First Stripe charge passed',
    [STATES.CLOVER_DISABLED]: 'Clover disabled - Stripe active',
    [STATES.STRIPE_ACTIVE]: 'Stripe active'
  };
  return labels[state] || 'Clover active';
}

function billingPeriodKey(dueDate) {
  const date = validDateKey(dueDate);
  return date ? 'due:' + date : '';
}

function paymentPeriodKey(payment = {}) {
  const direct = text(payment.billingPeriodKey);
  if (direct) return direct;
  return billingPeriodKey(payment.scheduledDueDate || payment.dueDate || payment.nextRun);
}

function dateFromKey(value) {
  const key = validDateKey(value);
  if (!key) return null;
  const parsed = new Date(key + 'T12:00:00.000Z');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKeyFromDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : '';
}

function addDaysToDateKey(value, days) {
  const parsed = dateFromKey(value);
  if (!parsed) return '';
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return dateKeyFromDate(parsed);
}

function addMonthsToDateKey(value, months, preferredDay) {
  const parsed = dateFromKey(value);
  if (!parsed) return '';
  const day = Math.max(1, Math.min(31, Number(preferredDay || parsed.getUTCDate())));
  const target = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + Number(months || 0), 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return dateKeyFromDate(target);
}

function paymentDueDateKey(payment = {}) {
  const direct = validDateKey(payment.scheduledDueDate || payment.dueDate || payment.nextRun);
  if (direct) return direct;
  const period = paymentPeriodKey(payment);
  const match = period.match(/^due:(\d{4}-\d{2}-\d{2})$/);
  return match ? validDateKey(match[1]) : '';
}

function billingPeriodEndDate(payment = {}, recurring = {}) {
  const storedEnd = validDateKey(payment.billingPeriodEndDate);
  if (storedEnd) return storedEnd;
  const start = paymentDueDateKey(payment);
  if (!start) return '';
  const frequency = text(payment.frequency || payment.billingFrequency || recurring.frequency || 'Weekly').toLowerCase();
  if (/one[ -]?time|deposit|first week|first weekly/.test(frequency)) return addDaysToDateKey(start, 1);
  if (/daily|every day/.test(frequency)) return addDaysToDateKey(start, 1);
  if (/bi[ -]?week|every 2 week/.test(frequency)) return addDaysToDateKey(start, 14);
  if (/semi[ -]?month|twice.*month/.test(frequency)) return addDaysToDateKey(start, 15);
  if (/month/.test(frequency)) {
    return addMonthsToDateKey(start, 1, Number(payment.monthlyDay || payment.dayOfMonth || recurring.monthlyDay || recurring.dayOfMonth) || Number(start.slice(8, 10)));
  }
  return addDaysToDateKey(start, 7);
}

function paymentCoversBillingDate(payment = {}, recurring = {}, dueDate) {
  const target = validDateKey(dueDate);
  const start = paymentDueDateKey(payment);
  if (!target || !start) return paymentPeriodKey(payment) === billingPeriodKey(target);
  const end = billingPeriodEndDate(payment, recurring);
  return target >= start && (!end ? target === start : target < end);
}

function paymentLinkedToRecurring(payment = {}, recurring = {}) {
  const recurringId = text(recurring.id || recurring.recurringPaymentId);
  const paymentRecurringId = text(payment.recurringPaymentId);
  if (paymentRecurringId) {
    if (!recurringId || paymentRecurringId !== recurringId) return false;
  }
  const recurringCloverSubscriptionId = cloverSubscriptionId(recurring);
  const paymentCloverSubscriptionId = cloverSubscriptionId(payment);
  if (paymentCloverSubscriptionId) {
    if (!recurringCloverSubscriptionId || paymentCloverSubscriptionId !== recurringCloverSubscriptionId) return false;
  }
  const recurringStripeSubscriptionId = text(recurring.stripeSubscriptionId);
  const paymentStripeSubscriptionId = text(payment.stripeSubscriptionId);
  if (paymentStripeSubscriptionId) {
    if (!recurringStripeSubscriptionId || paymentStripeSubscriptionId !== recurringStripeSubscriptionId) return false;
  }
  if (paymentRecurringId || paymentCloverSubscriptionId || paymentStripeSubscriptionId) return true;
  const stripeCustomerId = text(recurring.stripeCustomerId);
  if (stripeCustomerId && text(payment.stripeCustomerId) === stripeCustomerId) return true;
  const cloverCustomerId = text(recurring.cloverCustomerId);
  if (cloverCustomerId && text(payment.cloverCustomerId) === cloverCustomerId) return true;
  return false;
}

function existingPaidPayment(data = {}, recurring = {}, dueDate) {
  if (!billingPeriodKey(dueDate)) return null;
  const payments = Array.isArray(data.payments) ? data.payments : [];
  return payments.find(payment => payment.billingPeriodReleasedAfterRefund !== true && paymentLinkedToRecurring(payment, recurring) && paymentIsPaid(payment.status) && paymentCoversBillingDate(payment, recurring, dueDate)) || null;
}

function existingBillingPeriodPayment(data = {}, recurring = {}, dueDate) {
  if (!billingPeriodKey(dueDate)) return null;
  const payments = Array.isArray(data.payments) ? data.payments : [];
  return payments.find(payment => payment.billingPeriodReleasedAfterRefund !== true && paymentLinkedToRecurring(payment, recurring) && paymentConsumesBillingPeriod(payment.status) && paymentCoversBillingDate(payment, recurring, dueDate)) || null;
}

function isolatedProviderTestMode(environment = process.env) {
  const env = environment && typeof environment === 'object' ? environment : {};
  const deployedRuntime = String(env.RENDER || '').toLowerCase() === 'true'
    || !!text(env.RENDER_SERVICE_ID)
    || String(env.NODE_ENV || '').toLowerCase() === 'production';
  return !deployedRuntime
    && String(env.NODE_ENV || '').toLowerCase() === 'test'
    && String(env.WOA_ALLOW_ISOLATED_PROVIDER_TESTS || '') === '1';
}

function stripeCutoverLaunchError(message, code, missing = []) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  error.missing = Array.isArray(missing) ? missing.slice(0, 50) : [];
  return error;
}

function stripeLaunchSafetyError(message, code, missing = [], statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.missing = Array.isArray(missing) ? missing.slice(0, 50) : [];
  return error;
}

function stripeCardPreparationReady(options = {}) {
  if (options.isolatedTestMode === true) return true;
  return options.configured === true
    && text(options.keyMode).toLowerCase() === 'live'
    && options.webhookSecretConfigured === true
    && options.transactionalStateReady === true
    && options.privateDocumentStorageReady === true
    && options.stateBackupConfigured === true;
}

function assertStripeCardPreparationReady(options = {}) {
  if (stripeCardPreparationReady(options)) return { ready: true, isolatedTestMode: options.isolatedTestMode === true };
  const missing = [];
  if (options.configured !== true || text(options.keyMode).toLowerCase() !== 'live') missing.push('Stripe live secret key');
  if (options.webhookSecretConfigured !== true) missing.push('Stripe signed webhook secret');
  if (options.transactionalStateReady !== true) missing.push('transactional PostgreSQL state backend');
  if (options.privateDocumentStorageReady !== true) missing.push('production-ready encrypted private object storage');
  if (options.stateBackupConfigured !== true) missing.push('dedicated encrypted offsite state-backup configuration');
  throw stripeLaunchSafetyError(
    'Stripe card setup is not safe to launch. Keep Clover active until live Stripe, transactional PostgreSQL, encrypted private storage, and dedicated offsite backups are configured.',
    'stripe_card_preparation_not_live',
    missing
  );
}

function stripeIdentityPreparationReady(options = {}) {
  return stripeCardPreparationReady(options);
}

function assertStripeIdentityPreparationReady(options = {}) {
  if (stripeIdentityPreparationReady(options)) return { ready: true, isolatedTestMode: options.isolatedTestMode === true };
  const missing = [];
  if (options.configured !== true || text(options.keyMode).toLowerCase() !== 'live') missing.push('Stripe live secret key');
  if (options.webhookSecretConfigured !== true) missing.push('Stripe signed webhook secret');
  if (options.transactionalStateReady !== true) missing.push('transactional PostgreSQL state backend');
  if (options.privateDocumentStorageReady !== true) missing.push('production-ready encrypted private object storage');
  if (options.stateBackupConfigured !== true) missing.push('dedicated encrypted offsite state-backup configuration');
  throw stripeLaunchSafetyError(
    'Stripe Identity is not safe to launch. Keep identity review manual until live Stripe, transactional PostgreSQL, encrypted private storage, and dedicated offsite backups are configured.',
    'stripe_identity_preparation_not_live',
    missing
  );
}

function stripeMoneyActionsArmed(options = {}) {
  if (options.isolatedTestMode === true) return true;
  return options.productionHardeningRequired === true && stripeCardPreparationReady(options);
}

function assertStripeMoneyActionsArmed(options = {}) {
  if (stripeMoneyActionsArmed(options)) return { ready: true, isolatedTestMode: options.isolatedTestMode === true };
  const missing = [];
  if (options.productionHardeningRequired !== true) missing.push('WOA_PRODUCTION_HARDENING_REQUIRED=1');
  if (options.configured !== true || text(options.keyMode).toLowerCase() !== 'live') missing.push('Stripe live secret key');
  if (options.webhookSecretConfigured !== true) missing.push('Stripe signed webhook secret');
  if (options.transactionalStateReady !== true) missing.push('transactional PostgreSQL state backend');
  if (options.privateDocumentStorageReady !== true) missing.push('production-ready encrypted private object storage');
  if (options.stateBackupConfigured !== true) missing.push('dedicated encrypted offsite state-backup configuration');
  throw stripeLaunchSafetyError(
    'Stripe money actions are locked. Keep Clover active until production hardening, live Stripe, transactional PostgreSQL, encrypted private storage, and dedicated offsite backups are enabled.',
    'stripe_money_actions_not_armed',
    missing,
    409
  );
}

function stripeLiveResultAccepted(options = {}) {
  if (options.isolatedTestMode === true) return true;
  return text(options.keyMode).toLowerCase() === 'live' && options.livemode === true;
}

function assertStripeLiveResult(options = {}) {
  if (stripeLiveResultAccepted(options)) return { accepted: true, isolatedTestMode: options.isolatedTestMode === true };
  throw stripeLaunchSafetyError(
    (text(options.label) || 'Stripe result') + ' was not a live-mode result. WheelsonAuto ignored it so test activity cannot change a real customer account.',
    'stripe_live_result_required',
    ['Stripe live-mode provider result'],
    409
  );
}

function assertStripeCutoverLaunchReady(options = {}) {
  if (options.isolatedTestMode === true) return { ready: true, isolatedTestMode: true };
  if (options.productionHardeningRequired !== true) {
    throw stripeCutoverLaunchError(
      'Stripe cutover is not armed. Keep Clover active until the owner enables production hardening after every live launch check is clear.',
      'stripe_cutover_launch_not_armed',
      ['WOA_PRODUCTION_HARDENING_REQUIRED=1']
    );
  }
  const preflight = options.preflight && typeof options.preflight === 'object' ? options.preflight : {};
  if (preflight.readyForLiveStripe !== true) {
    const missing = Array.isArray(preflight.missing) ? preflight.missing.filter(Boolean) : [];
    throw stripeCutoverLaunchError(
      'Stripe cutover is blocked until the live launch preflight is clear' + (missing.length ? ': ' + missing.join(', ') : '.'),
      'stripe_cutover_preflight_blocked',
      missing
    );
  }
  return { ready: true, isolatedTestMode: false };
}

function duplicateChargeError(existing, dueDate) {
  const status = text(existing && existing.status) || 'protected';
  const error = new Error('A ' + status + ' payment record already occupies the ' + validDateKey(dueDate) + ' billing period. WheelsonAuto blocked a duplicate charge; review that record before any owner-approved additional charge.');
  error.code = 'duplicate_billing_period';
  error.statusCode = 409;
  error.existingPayment = existing || null;
  return error;
}

function assertBillingPeriodOpen(data, recurring, dueDate, options = {}) {
  const existing = existingBillingPeriodPayment(data, recurring, dueDate);
  if (existing && options.allowAdditionalManualCharge !== true) throw duplicateChargeError(existing, dueDate);
  return existing;
}

function migrationTransitionError(currentState, nextState, message) {
  const error = new Error(message || ('Stripe migration cannot move from ' + currentState + ' to ' + nextState + '. Complete each protected cutover step in order.'));
  error.code = 'invalid_stripe_migration_transition';
  error.statusCode = 409;
  error.currentState = currentState;
  error.nextState = nextState;
  return error;
}

function assertTransitionEvidence(row, currentState, nextState, migration) {
  if (nextState === STATES.STRIPE_CARD_SAVED && currentState !== nextState && !hasStripeCard(row) && !text(migration.cardSavedAt)) {
    throw migrationTransitionError(currentState, nextState, 'A verified Stripe card setup result is required before the card-saved migration stage.');
  }
  if (nextState === STATES.CUTOVER_SCHEDULED && !validDateKey(migration.cutoverDate)) {
    throw migrationTransitionError(currentState, nextState, 'A protected cutover date is required before Stripe can be scheduled.');
  }
  if (nextState === STATES.CUTOVER_SCHEDULED && hasCloverSource(row) && !text(migration.scheduledCloverSubscriptionId)) {
    throw migrationTransitionError(currentState, nextState, 'The exact Clover subscription ID must be bound to the protected cutover before Stripe can be scheduled.');
  }
  const protectedStripeStates = [
    STATES.FIRST_STRIPE_CHARGE_PENDING,
    STATES.FIRST_STRIPE_CHARGE_PASSED,
    STATES.CLOVER_DISABLED,
    STATES.STRIPE_ACTIVE
  ];
  if (hasCloverSource(row) && protectedStripeStates.includes(nextState)) {
    if (!validDateKey(migration.cutoverDate) || !text(migration.scheduledCloverSubscriptionId) || !text(migration.cloverStoppedConfirmedAt)) {
      throw migrationTransitionError(currentState, nextState, 'The protected cutover date, exact Clover subscription binding, and owner Clover-stop confirmation are all required before Stripe can own a billing period.');
    }
  }
  if (hasCloverSource(row) && [STATES.FIRST_STRIPE_CHARGE_PASSED, STATES.CLOVER_DISABLED, STATES.STRIPE_ACTIVE].includes(nextState)) {
    if (!text(migration.firstStripeChargeAt) || !text(migration.firstStripePaymentIntentId)) {
      throw migrationTransitionError(currentState, nextState, 'A verified first Stripe payment and PaymentIntent are required before the migration can advance.');
    }
  }
  if (hasCloverSource(row) && [STATES.CLOVER_DISABLED, STATES.STRIPE_ACTIVE].includes(nextState)) {
    if (!text(migration.cloverDisabledAt)) {
      throw migrationTransitionError(currentState, nextState, 'Clover can be marked disabled only after the verified first Stripe charge is recorded.');
    }
  }
}

function transition(row = {}, nextState, details = {}) {
  const current = migrationRecord(row);
  const now = text(details.at) || new Date().toISOString();
  const state = text(nextState).toLowerCase();
  if (!Object.values(STATES).includes(state)) {
    throw migrationTransitionError(current.state, state || 'unknown', 'WheelsonAuto rejected an unknown Stripe migration state.');
  }
  if (state !== current.state && !(FORWARD_TRANSITIONS[current.state] || []).includes(state)) {
    throw migrationTransitionError(current.state, state);
  }
  const entry = {
    state,
    at: now,
    by: text(details.by),
    note: text(details.note).slice(0, 500)
  };
  const history = current.history.concat(entry).slice(-30);
  const next = { ...current, ...details, state, history, updatedAt: now };
  delete next.at;
  delete next.by;
  delete next.note;
  assertTransitionEvidence(row, current.state, state, next);
  return next;
}

function rollbackToClover(row = {}, details = {}) {
  const current = migrationRecord(row);
  const currentProvider = provider(row.paymentProvider || row.provider || 'clover');
  const requiresStripeStopConfirmation = currentProvider === 'stripe' || [
    STATES.FIRST_STRIPE_CHARGE_PENDING,
    STATES.FIRST_STRIPE_CHARGE_PASSED,
    STATES.CLOVER_DISABLED,
    STATES.STRIPE_ACTIVE
  ].includes(current.state);
  if (requiresStripeStopConfirmation && !text(details.stripeStoppedConfirmedAt)) {
    throw migrationTransitionError(current.state, hasStripeCard(row) ? STATES.STRIPE_CARD_SAVED : STATES.CLOVER_ACTIVE, 'Confirm that Stripe autopay is stopped before returning this customer to Clover.');
  }
  const now = text(details.at) || new Date().toISOString();
  const state = hasStripeCard(row) ? STATES.STRIPE_CARD_SAVED : STATES.CLOVER_ACTIVE;
  const entry = {
    state,
    at: now,
    by: text(details.by),
    note: text(details.note || 'Protected Stripe cutover cancelled; Clover remains active.').slice(0, 500)
  };
  const cutoverWasStarted = !!(
    current.cutoverDate
    || current.cutoverScheduledAt
    || current.cloverStoppedConfirmedAt
    || current.firstStripeChargeAt
    || current.firstStripeChargeFailedAt
    || current.cloverDisabledAt
  );
  const closedCutovers = current.closedCutovers.slice(-9);
  if (cutoverWasStarted) {
    closedCutovers.push({
      state: current.state,
      cutoverDate: current.cutoverDate,
      scheduledCloverSubscriptionId: current.scheduledCloverSubscriptionId,
      cloverStoppedConfirmedAt: current.cloverStoppedConfirmedAt,
      cloverStoppedConfirmedBy: current.cloverStoppedConfirmedBy,
      firstStripeChargeAt: current.firstStripeChargeAt,
      firstStripePaymentIntentId: current.firstStripePaymentIntentId,
      firstStripeChargeFailedAt: current.firstStripeChargeFailedAt,
      firstStripeChargeFailureCount: current.firstStripeChargeFailureCount,
      firstStripeChargeFailureIntentId: current.firstStripeChargeFailureIntentId,
      firstStripeChargeFailureError: current.firstStripeChargeFailureError,
      cloverDisabledAt: current.cloverDisabledAt,
      cloverDisabledBy: current.cloverDisabledBy,
      stripeStoppedConfirmedAt: text(details.stripeStoppedConfirmedAt),
      rolledBackAt: now,
      rolledBackBy: text(details.by)
    });
  }
  return {
    ...current,
    state,
    history: current.history.concat(entry).slice(-30),
    closedCutovers,
    cutoverDate: '',
    cutoverScheduledAt: '',
    scheduledCloverSubscriptionId: '',
    cloverStoppedConfirmedAt: '',
    cloverStoppedConfirmedBy: '',
    firstStripeChargeAt: '',
    firstStripePaymentIntentId: '',
    firstStripeChargeFailedAt: '',
    firstStripeChargeFailureCount: 0,
    firstStripeChargeFailureIntentId: '',
    firstStripeChargeFailureError: '',
    cloverDisabledAt: '',
    cloverDisabledBy: '',
    updatedAt: now
  };
}

function automaticChargeAllowed(row = {}, paymentProvider, dateKey) {
  const currentProvider = provider(row.paymentProvider || row.provider || 'clover');
  if (provider(paymentProvider) !== currentProvider) return false;
  const migration = migrationRecord(row);
  if (migration.state === STATES.CLOVER_ACTIVE) return currentProvider === 'clover';
  // Saving a Stripe card is preparation only. Clover remains responsible for
  // every billing period before the protected cutover date.
  if (migration.state === STATES.STRIPE_SETUP_SENT || migration.state === STATES.STRIPE_CARD_SAVED) {
    return currentProvider === 'clover';
  }
  if (migration.state === STATES.CUTOVER_SCHEDULED) {
    const cutoverDate = migration.cutoverDate;
    return currentProvider === 'clover' && !!cutoverDate && !!validDateKey(dateKey) && validDateKey(dateKey) < cutoverDate;
  }
  if (currentProvider === 'stripe' && hasCloverSource(row) && migration.state === STATES.FIRST_STRIPE_CHARGE_PENDING) {
    const cutoverDate = migration.cutoverDate;
    const chargeDate = validDateKey(dateKey);
    return !!(migration.cloverStoppedConfirmedAt && cutoverDate && chargeDate && chargeDate >= cutoverDate);
  }
  if (migration.state === STATES.FIRST_STRIPE_CHARGE_PENDING) return currentProvider === 'stripe' && !hasCloverSource(row);
  if ([STATES.FIRST_STRIPE_CHARGE_PASSED, STATES.CLOVER_DISABLED, STATES.STRIPE_ACTIVE].includes(migration.state)) {
    return currentProvider === 'stripe';
  }
  return false;
}

module.exports = {
  STATES,
  provider,
  validDateKey,
  paymentIsPaid,
  paymentConsumesBillingPeriod,
  hasCloverSource,
  hasStripeCard,
  activeCutoverRow,
  resolvedCustomerName,
  cloverSubscriptionId,
  cutoverEligibility,
  migrationRecord,
  stateLabel,
  billingPeriodKey,
  paymentPeriodKey,
  paymentDueDateKey,
  billingPeriodEndDate,
  paymentCoversBillingDate,
  paymentLinkedToRecurring,
  existingPaidPayment,
  existingBillingPeriodPayment,
  isolatedProviderTestMode,
  stripeCutoverLaunchError,
  stripeLaunchSafetyError,
  stripeCardPreparationReady,
  assertStripeCardPreparationReady,
  stripeIdentityPreparationReady,
  assertStripeIdentityPreparationReady,
  stripeMoneyActionsArmed,
  assertStripeMoneyActionsArmed,
  stripeLiveResultAccepted,
  assertStripeLiveResult,
  assertStripeCutoverLaunchReady,
  duplicateChargeError,
  assertBillingPeriodOpen,
  migrationTransitionError,
  transition,
  rollbackToClover,
  automaticChargeAllowed
};
