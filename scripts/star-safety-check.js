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

function finalFunctionSlice(source, name) {
  let start = -1;
  let cursor = 0;
  while (true) {
    const normalNext = source.indexOf('function ' + name + '(', cursor);
    const asyncNext = source.indexOf('async function ' + name + '(', cursor);
    const candidates = [normalNext, asyncNext].filter(index => index >= 0);
    const next = candidates.length ? Math.min(...candidates) : -1;
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const argsClose = source.indexOf(')', start);
  const open = source.indexOf('{', argsClose > -1 ? argsClose : start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

const aiRules = finalFunctionSlice(server, 'aiPlanRules');
const sanitize = finalFunctionSlice(server, 'sanitizeAiPlan');
const openAiPlan = finalFunctionSlice(server, 'openAiReplyPlan');
const safeLinks = finalFunctionSlice(server, 'prepareAiSafeLink');
const preparedAction = finalFunctionSlice(server, 'starPreparedAction');
const aiDraft = finalFunctionSlice(server, 'createAiMessageDraft');
const aiFindContext = finalFunctionSlice(server, 'aiFindCustomerContext');
const aiContext = finalFunctionSlice(server, 'aiContextSummary');
const aiHealth = finalFunctionSlice(server, 'aiSystemHealthForContext');
const messageContacts = finalFunctionSlice(server, 'messageContactCandidates');
const approve = finalFunctionSlice(server, 'approveAiMessage');
const apiAllowed = finalFunctionSlice(server, 'apiAllowedForUser');
const starPanel = finalFunctionSlice(app, 'starAiPanel');
const starReadiness = finalFunctionSlice(app, 'starReadinessPanel') + finalFunctionSlice(app, 'starCapabilityItems');
const starHealth = finalFunctionSlice(app, 'starSystemHealthPanelFresh') || finalFunctionSlice(app, 'starSystemHealthPanel');
const starQaManager = (finalFunctionSlice(app, 'starQaManagerPanel') || '') + (finalFunctionSlice(app, 'starQaManagerPanelFresh') || '');
const starActions = finalFunctionSlice(app, 'starAiActions');

if (!aiRules || !sanitize || !openAiPlan || !safeLinks || !aiDraft || !aiFindContext || !aiContext || !aiHealth || !approve || !apiAllowed || !starPanel || !starReadiness || !starHealth || !starQaManager || !starActions) {
  fail('Missing Star AI frontend/backend safety functions.');
}

[
  'charge_saved_card',
  'approvalRequired = true',
  'Customer requested a saved-card charge',
  'change_autopay_date',
  'Autopay date/time/frequency changes require admin approval.',
  'paid_outside_review',
  'Paid-outside-app claims need admin verification',
  'send_receipt',
  'Receipts are tied to payment history and require admin confirmation before sending.',
  'send_account_statement',
  'sensitive_or_dispute',
  'human_review',
  'stop autopay',
  'send_claim_link'
].forEach(text => requireText('Star rule guardrails', aiRules, text));

[
  'const sensitiveActions =',
  'charge_saved_card',
  'change_autopay_date',
  'send_claim_link',
  'paid_outside_review',
  'send_receipt',
  'send_account_statement',
  'contract_esign_request',
  'sensitiveActions.includes(safe.actionType)',
  'safe.canAutoSend = !!safe.canAutoSend && !safe.approvalRequired && !safe.needsHuman'
].forEach(text => requireText('Star sanitizer guardrails', sanitize, text));

[
  'OPENAI_BASE_URL',
  "'gpt-5.5'",
  'WOA_AI_REASONING_EFFORT',
  'WOA_AI_TIMEOUT_MS',
  'parseStarAiJson',
  'starModelSupportsReasoning',
  'starSafetyIdentifier',
  'store: false',
  "text: { format: { type: 'json_object' } }",
  'prompt_cache_key',
  'safety_identifier',
  'provider: \'openai\'',
  'provider: \'rules\'',
  'providerError',
  'Never promise a charge, refund, autopay change, cancellation, removal, toll charge, saved-card action, password reset, receipt, payoff, or contract/e-sign send has happened unless an admin approved it.',
  'requiresAdminApproval',
  'saved-card charge',
  'autopay date/time/frequency change',
  'card removal',
  'refund/dispute',
  'paid outside app verification',
  'receipt after charge confirmation',
  'account statement or payoff letter'
].forEach(text => requireText('OpenAI Star prompt guardrails', server + openAiPlan, text));

[
  'systemHealthSnapshot',
  'nextActions',
  'systemHealth: aiSystemHealthForContext',
  'systemHealth: context.systemHealth',
  'const namedRow',
  'normKey(getName(row)) === name',
  '!recurring && !name && phone',
  '!customer && !name && phone',
  '!contract && !name && phone'
].forEach(text => requireText('Star platform health context', aiHealth + aiFindContext + aiContext, text));

[
  'message history',
  'row.phone || row.from || row.to',
  'data.messages'
].forEach(text => requireText('Star message-history contact safety', messageContacts, text));

[
  'if (!plan || plan.needsHuman || plan.approvalRequired) return plan',
  "plan.actionType === 'send_payment_link'",
  'createPaymentRequest',
  "plan.actionType === 'send_card_setup'",
  'createCardSetupRequest',
  'No payment amount was found',
  'No customer or recurring amount was found'
].forEach(text => requireText('Star safe link preparation', safeLinks, text));

[
  'function starPreparedAction',
  'requiresAdminApproval',
  'vehicle',
  'vin',
  'tag',
  'amount',
  'paymentLinkUrl',
  'cardSetupUrl',
  'No charge was run',
  'No schedule was changed'
].forEach(text => requireText('Star prepared action metadata', preparedAction, text));

[
  "status: plan.needsHuman ? 'Human needed' : (plan.approvalRequired ? 'Needs approval'",
  "source: 'WheelsonAuto Star AI'",
  'aiPlan: plan',
  'plan.preparedAction = starPreparedAction',
  'options.user',
  'recurringPaymentId',
  'claimId'
].forEach(text => requireText('Star draft record context', aiDraft, text));

[
  'if (plan.needsHuman) throw new Error',
  'if (plan.approvalRequired && payload.approveMoneyAction !== true) throw new Error',
  'This AI item prepares a money or account change',
  'sendProviderEmail',
  'sendProviderSms'
].forEach(text => requireText('Star approval endpoint safety', approve, text));

[
  "role === 'mechanic' && pathname.startsWith('/api/messages')",
  "role === 'mechanic' || role === 'manager'"
].forEach(text => requireText('Star role API safety', apiAllowed, text));

[
  'Charges and account changes require approval.',
  'toggle-messaging',
  'toggle-email-messaging',
  'toggle-star-ai',
  'toggle-star-autosend'
].forEach(text => requireText('Star settings UI safety', starPanel, text));

[
  'star-provider-strip',
  'Star readiness',
  'Test Star provider',
  'OpenAI connected',
  'Rules fallback',
  'Payment follow-up',
  'Tolls, claims, disputes',
  'Receipts and documents',
  'Safe auto-send',
  'Star is inside the app',
  'aiLastProviderError',
  'star-openai-setup-card',
  'OPENAI_API_KEY or WOA_OPENAI_API_KEY',
  'Default model: gpt-5.5',
  'Test does not send texts, charge cards, or change accounts'
].forEach(text => requireText('Star provider UI safety', app + starReadiness, text));

[
  'Missing VIN',
  'Unmatched payments',
  'Dispute match review',
  'Missing contact',
  'Setup / not found',
  'Open payment links',
  'Stale payment links',
  'Open card setup links',
  'Pending Star approvals',
  'Vehicle assignment conflicts',
  'Sensitive changes',
  'Star can flag issues and draft fixes',
  'money moves, card changes, removals, disputes, and receipts still require admin approval'
].forEach(text => requireText('Star QA system health safety', starHealth, text));

[
  'star-ai-queue',
  'payload={customer:q.customer,phone:q.phone,email:q.email',
  'messageQueueVehicleContext',
  'Payment not found',
  'Open payment link',
  'hosted checkout link still open'
].forEach(text => requireText('Star queue context safety', app, text));

[
  'function starCommandItems',
  'Star command queue',
  'Failed twice',
  'Payment not found',
  'Unmatched transaction',
  'Vehicle conflict',
  'Missing VIN',
  'Service due',
  'Claim match needed',
  'Open card setup link',
  'Star approval',
  'Portal login needed'
].forEach(text => requireText('Star command queue safety', app, text));

[
  'function platformReadinessItems',
  'Platform readiness map',
  'Payment engine',
  'Customer + fleet truth',
  'Daily closeout',
  'Messages + Star',
  'Customer portal',
  'Inspections + service',
  'Tolls, claims, disputes',
  'Role portals',
  'Companies / franchise',
  'API readiness',
  'Reports + accounting',
  'APIs plug into these modules later'
].forEach(text => requireText('WheelsonAuto iFleet readiness map', app, text));

[
  'Star QA manager',
  'Contact failed-twice customers',
  'Match transactions',
  'Review dispute matches',
  'Resolve vehicle assignment conflicts',
  'Link autopay to vehicles',
  'Clear verification inbox',
  'Follow up stale payment links',
  'Follow up open payment links',
  'Follow up card setup links',
  'Approve pending Star work',
  'card setup/change link(s) are still waiting',
  'need admin approval or human review',
  'Review today sensitive changes',
  'admin approval is still required for charges, removals, card changes, claims, refunds, and receipts'
].forEach(text => requireText('Star QA manager suggestions', starQaManager, text));

[
  'star-prepared-action',
  'p.preparedAction'
].forEach(text => requireText('Star prepared action UI card', app, text));

[
  "p.actionType==='charge_saved_card'",
  "data-action=\"record-charge\"",
  "p.actionType==='change_autopay_date'",
  "data-action=\"change-autopay-date\"",
  "p.actionType==='send_payment_link'",
  "data-action=\"send-pay-link\"",
  "p.actionType==='send_card_setup'",
  "data-action=\"change-card-on-file\""
].forEach(text => requireText('Star UI approval routing', starActions, text));

console.log('Star safety check passed: AI drafts are contextual, safe links are controlled, and money/account actions require admin approval.');
