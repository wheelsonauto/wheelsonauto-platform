'use strict';

const READ_TOOLS = Object.freeze({
  read_customer_file: Object.freeze({ resource: 'customer', access: 'read', description: 'Read the matched customer contact and account status.' }),
  read_rental_file: Object.freeze({ resource: 'rental_file', access: 'read', description: 'Read the active Rental File and linked vehicle identity.' }),
  read_payment_status: Object.freeze({ resource: 'payment', access: 'read', description: 'Read schedule, latest payment, open links, and card-setup state.' }),
  read_service_status: Object.freeze({ resource: 'maintenance', access: 'read', description: 'Read open maintenance and inspection work.' }),
  read_claim_status: Object.freeze({ resource: 'claim', access: 'read', description: 'Read matched toll, violation, claim, and dispute status.' }),
  read_application_status: Object.freeze({ resource: 'application', access: 'read', description: 'Read application, verification, documents, and pickup progress.' }),
  read_message_history: Object.freeze({ resource: 'message', access: 'read', description: 'Read the bounded recent conversation for the exact customer.' }),
  read_platform_health: Object.freeze({ resource: 'system_health', access: 'read', description: 'Read launch blockers and workflow coverage without changing data.' })
});

const ACTION_TOOLS = Object.freeze({
  reply: Object.freeze({ access: 'draft', autoSendEligible: true, approvalRequired: false, description: 'Draft or send a normal customer reply.' }),
  send_payment_link: Object.freeze({ access: 'draft_link', autoSendEligible: true, approvalRequired: false, description: 'Prepare a secure customer-paid payment link without charging a saved card.' }),
  send_card_setup: Object.freeze({ access: 'draft_link', autoSendEligible: true, approvalRequired: false, description: 'Prepare a secure card setup/change link without exposing card details.' }),
  maintenance_schedule: Object.freeze({ access: 'draft', autoSendEligible: true, approvalRequired: false, description: 'Draft service scheduling guidance; staff workflow owns the appointment.' }),
  portal_login_help: Object.freeze({ access: 'draft', autoSendEligible: false, approvalRequired: false, description: 'Draft login guidance without resetting credentials or impersonating the customer.' }),
  charge_saved_card: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a saved-card charge request; owner executes it in Payments.' }),
  change_autopay_date: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a schedule-change request; owner confirms the exact plan and date.' }),
  paid_outside_review: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a paid-outside review; owner verifies proof before status changes.' }),
  send_receipt: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a receipt request; owner confirms the exact payment first.' }),
  send_account_statement: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare an account statement/payoff request for owner verification.' }),
  contract_esign_request: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a contract/e-sign request; staff verifies the exact file first.' }),
  send_claim_link: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a matched claim/toll link; owner confirms evidence and amount.' }),
  remove_customer: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare customer removal; owner uses the return/end workflow.' }),
  remove_card: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare card removal; owner confirms the exact payment profile.' }),
  delete_card: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare card deletion; owner confirms the exact payment profile.' }),
  refund: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a refund review; owner confirms provider evidence.' }),
  dispute: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a dispute review; owner controls submission and evidence.' }),
  toll_charge: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a toll charge; owner confirms match, proof, and amount.' }),
  claim_charge: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare a claim charge; owner confirms match, proof, and amount.' }),
  edit_autopay: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare an autopay edit; owner confirms the exact recurring plan.' }),
  cancel_autopay: Object.freeze({ access: 'approval', autoSendEligible: false, approvalRequired: true, description: 'Prepare autopay cancellation; owner confirms the customer lifecycle.' }),
  human_review: Object.freeze({ access: 'human', autoSendEligible: false, approvalRequired: false, needsHuman: true, description: 'Route unclear, sensitive, legal, safety, or unsupported work to staff.' })
});

function actionTool(actionType) {
  const key = String(actionType || '').trim().toLowerCase();
  return key && ACTION_TOOLS[key] ? { name: key, ...ACTION_TOOLS[key] } : null;
}

function enforcePlanPolicy(plan = {}) {
  const safe = { ...plan };
  const requestedAction = String(safe.actionType || 'reply').trim().toLowerCase();
  let tool = actionTool(requestedAction);
  if (!tool) {
    tool = actionTool('human_review');
    safe.actionType = 'human_review';
    safe.needsHuman = true;
    safe.approvalRequired = true;
    safe.canAutoSend = false;
    safe.reasons = [...(Array.isArray(safe.reasons) ? safe.reasons : []), 'Star requested an unsupported action and routed it to staff review.'].slice(0, 6);
  } else {
    safe.actionType = tool.name;
    safe.approvalRequired = !!safe.approvalRequired || tool.approvalRequired;
    safe.needsHuman = !!safe.needsHuman || tool.needsHuman === true;
    safe.canAutoSend = !!safe.canAutoSend && tool.autoSendEligible && !safe.approvalRequired && !safe.needsHuman;
  }
  safe.tool = {
    name: tool.name,
    access: tool.access,
    approvalRequired: !!safe.approvalRequired,
    autoSendEligible: !!tool.autoSendEligible,
    executionBoundary: tool.access === 'approval'
      ? 'Owner executes the exact scoped workflow; Star never moves money or changes the account.'
      : tool.access === 'human'
        ? 'Staff review only.'
        : 'Message or secure-link draft only.'
  };
  return safe;
}

function promptCatalog() {
  return {
    reads: Object.entries(READ_TOOLS).map(([name, tool]) => ({ name, ...tool })),
    actions: Object.entries(ACTION_TOOLS).map(([name, tool]) => ({ name, ...tool }))
  };
}

module.exports = {
  READ_TOOLS,
  ACTION_TOOLS,
  actionTool,
  enforcePlanPolicy,
  promptCatalog
};
