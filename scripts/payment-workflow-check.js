const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function requireText(label, source, text) {
  if (!source.includes(text)) fail(label + ' is missing: ' + text);
}

function finalFunctionSlice(name) {
  let start = -1;
  let cursor = 0;
  while (true) {
    const next = app.indexOf('function ' + name + '(', cursor);
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const argsClose = app.indexOf(')', start);
  const open = app.indexOf('{', argsClose > -1 ? argsClose : start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    const char = app[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  return '';
}

const paymentState = finalFunctionSlice('paymentState');
const cardActions = finalFunctionSlice('cardActionButtons');
const dailyCloseout = finalFunctionSlice('dailyCloseout');
const paymentCloseout = finalFunctionSlice('paymentCloseoutBoard');
const customerFileVehicleOptions = finalFunctionSlice('customerFileVehicleOptions');
const paymentTransactionCard = finalFunctionSlice('paymentTransactionCard');
const transactionCustomerName = finalFunctionSlice('transactionCustomerName');
const transactionPossibleMatches = finalFunctionSlice('transactionPossibleMatches');
const applyTransactionCandidate = finalFunctionSlice('applyTransactionCandidate');

if (!paymentState || !cardActions || !dailyCloseout || !paymentCloseout) {
  fail('Missing core payment workflow functions.');
}

[
  'chargeable',
  'card linked',
  'setup needed',
  'payment not found',
  'pending today',
  'failed once',
  'failed twice',
  'paid',
  'history'
].forEach(status => requireText('Payment state taxonomy', paymentState.toLowerCase(), status));

[
  'record-charge',
  'send-pay-link',
  'record-manual-charge',
  'change-card-on-file',
  'change-autopay-date',
  'remove-autopay',
  'delete-card-setup',
  'customerPortalButton',
  'customerFileButton'
].forEach(action => requireText('Payment card actions', cardActions, action));

[
  'Expected today',
  'Collected today',
  'Paid outside app',
  'Still open',
  'Failed once',
  'Contact now',
  'Today Clover transactions',
  'Verification inbox',
  'verifyRows',
  'paymentState(r).key'
].forEach(text => requireText('Daily closeout board', dailyCloseout, text));

[
  'Retry watch',
  'Not found',
  'Setup needed',
  "data-tab=\"'+esc(l[4])+'\"",
  "'Today'"
].forEach(text => requireText('Payment closeout board', paymentCloseout, text));

if (app.includes('data-tab="Attention"') || app.includes("data-tab='Attention'")) {
  fail('Payments still contains stale Attention tab wiring.');
}

[
  "if(a==='record-charge')",
  "if(a==='confirm-saved-card-charge')",
  "if(a==='charge-saved-card')",
  "if(a==='record-manual-charge')",
  "if(a==='save-charge')",
  "if(a==='change-card-on-file')",
  "if(a==='create-replacement-card-setup')",
  "if(a==='save-autopay')",
  "if(a==='save-contract-file')"
].forEach(text => requireText('Payment/customer action handler', app, text));

[
  'function openEndCustomerFile',
  'async function confirmEndCustomerFile',
  "b.dataset.action==='confirm-end-contract-file'",
  'End customer',
  'Vehicle returned'
].forEach(text => requireText('End customer dedicated workflow', app, text));

[
  'Payment not found - check Clover',
  '1x failed - retrying',
  '2x failed - contact customer',
  'Paid outside app',
  'lastPaymentResult',
  'paymentAttempts'
].forEach(text => requireText('Manual payment result tracking', app, text));

[
  'transferVehicleToCustomer',
  'stopCustomerAutopayForReturn',
  'resolveCustomerFileVehicle',
  'selectedRecurringVehicle',
  'recurringReadyVehicleOptions',
  'Search ready fleet vehicle'
].forEach(text => requireText('Customer/fleet reassignment workflow', app, text));

[
  'VIN ',
  'Tag ',
  'Tracker ',
  'currentCustomer',
  'Ready fleet'
].forEach(text => requireText('Vehicle picker detail', customerFileVehicleOptions, text));

[
  'transactionCustomerName',
  'transactionPossibleMatches',
  'Needs Clover/customer match',
  'apply-transaction-match',
  'Use match',
  'customerFileButton'
].forEach(text => requireText('Transaction customer matching card', paymentTransactionCard, text));
[
  'extCustomer&&/\\s/.test(extCustomer)',
  'cloverCustomerId',
  'same.length===1'
].forEach(text => requireText('Transaction customer matching helper', transactionCustomerName, text));
[
  'same amount',
  'same attempt date/amount',
  'saved attempt id',
  'Clover customer reference',
  'vin',
  'plate',
  'tracker'
].forEach(text => requireText('Transaction possible match helper', transactionPossibleMatches, text));
[
  'customerMatchStatus',
  'Admin accepted possible transaction match',
  'candidate.vin',
  'candidate.plate',
  'candidate.tracker',
  'candidate.phone',
  'candidate.email'
].forEach(text => requireText('Apply transaction match helper', applyTransactionCandidate, text));

[
  '/api/integrations/clover/manual-charge',
  'recurringPaymentId',
  'customer',
  'vehicleId',
  'vin',
  'licensePlate',
  'tracker',
  'paymentAttempts',
  'Payment not found'
].forEach(text => requireText('Saved-card/manual charge backend', server, text));

console.log('Payment workflow check passed: statuses, closeout, card actions, transaction matching, reassignment, and backend charge tracking are wired.');
