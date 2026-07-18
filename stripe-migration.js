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
  return !!status && !/(fail|declin|void|refund|dispute|not found|rejected|cancel)/.test(status) && (/^paid\b/.test(status) || /succeed|success|captur|complete/.test(status));
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

function cutoverEligibility(data = {}, row = {}) {
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
    setupSentAt: text(source.setupSentAt || row.stripeSetupSentAt),
    cardSavedAt: text(source.cardSavedAt || row.stripeCardSavedAt),
    cutoverDate: validDateKey(source.cutoverDate || row.stripeCutoverDate),
    cutoverScheduledAt: text(source.cutoverScheduledAt || row.stripeCutoverScheduledAt),
    cloverStoppedConfirmedAt: text(source.cloverStoppedConfirmedAt || row.cloverStoppedConfirmedAt),
    cloverStoppedConfirmedBy: text(source.cloverStoppedConfirmedBy || row.cloverStoppedConfirmedBy),
    firstStripeChargeAt: text(source.firstStripeChargeAt || row.firstStripeChargeAt),
    firstStripePaymentIntentId: text(source.firstStripePaymentIntentId || row.firstStripePaymentIntentId),
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

function paymentLinkedToRecurring(payment = {}, recurring = {}) {
  const recurringId = text(recurring.id || recurring.recurringPaymentId);
  if (recurringId && text(payment.recurringPaymentId) === recurringId) return true;
  const stripeCustomerId = text(recurring.stripeCustomerId);
  if (stripeCustomerId && text(payment.stripeCustomerId) === stripeCustomerId) return true;
  const cloverCustomerId = text(recurring.cloverCustomerId);
  if (cloverCustomerId && text(payment.cloverCustomerId) === cloverCustomerId) return true;
  return false;
}

function existingPaidPayment(data = {}, recurring = {}, dueDate) {
  const period = billingPeriodKey(dueDate);
  if (!period) return null;
  const payments = Array.isArray(data.payments) ? data.payments : [];
  return payments.find(payment => paymentLinkedToRecurring(payment, recurring) && paymentIsPaid(payment.status) && paymentPeriodKey(payment) === period) || null;
}

function duplicateChargeError(existing, dueDate) {
  const error = new Error('A successful payment is already recorded for the ' + validDateKey(dueDate) + ' billing period. WheelsonAuto blocked a duplicate charge.');
  error.code = 'duplicate_billing_period';
  error.statusCode = 409;
  error.existingPayment = existing || null;
  return error;
}

function assertBillingPeriodOpen(data, recurring, dueDate, options = {}) {
  const existing = existingPaidPayment(data, recurring, dueDate);
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
  if (nextState === STATES.FIRST_STRIPE_CHARGE_PENDING && hasCloverSource(row)) {
    if (!validDateKey(migration.cutoverDate) || !text(migration.cloverStoppedConfirmedAt)) {
      throw migrationTransitionError(currentState, nextState, 'Confirm the exact cutover date and that Clover was stopped before the first Stripe charge can become pending.');
    }
  }
  if (nextState === STATES.FIRST_STRIPE_CHARGE_PASSED && hasCloverSource(row)) {
    if (!text(migration.firstStripeChargeAt) || !text(migration.firstStripePaymentIntentId)) {
      throw migrationTransitionError(currentState, nextState, 'A verified first Stripe payment and PaymentIntent are required before the migration can advance.');
    }
  }
  if (nextState === STATES.CLOVER_DISABLED && hasCloverSource(row)) {
    if (!text(migration.firstStripeChargeAt) || !text(migration.firstStripePaymentIntentId) || !text(migration.cloverDisabledAt)) {
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
  return {
    ...current,
    state,
    history: current.history.concat(entry).slice(-30),
    cutoverDate: '',
    cutoverScheduledAt: '',
    cloverStoppedConfirmedAt: '',
    cloverStoppedConfirmedBy: '',
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
  paymentLinkedToRecurring,
  existingPaidPayment,
  duplicateChargeError,
  assertBillingPeriodOpen,
  migrationTransitionError,
  transition,
  rollbackToClover,
  automaticChargeAllowed
};
