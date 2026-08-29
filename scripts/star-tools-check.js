'use strict';

const assert = require('node:assert');
const starTools = require('../star-tools');

const safeReply = starTools.enforcePlanPolicy({ actionType: 'reply', canAutoSend: true, confidence: 0.95 });
assert.strictEqual(safeReply.canAutoSend, true, 'A normal allowlisted reply may remain eligible for safe auto-send.');
assert.strictEqual(safeReply.tool.access, 'draft', 'A normal reply must remain a draft/message tool.');

const charge = starTools.enforcePlanPolicy({ actionType: 'charge_saved_card', canAutoSend: true, approvalRequired: false });
assert.strictEqual(charge.approvalRequired, true, 'A model cannot remove owner approval from a saved-card charge.');
assert.strictEqual(charge.canAutoSend, false, 'A saved-card charge can never auto-send or execute through Star.');
assert.match(charge.tool.executionBoundary, /Owner executes/, 'Sensitive work must name the owner execution boundary.');

const unknown = starTools.enforcePlanPolicy({ actionType: 'transfer_all_money', canAutoSend: true });
assert.strictEqual(unknown.actionType, 'human_review', 'An unknown model action must fail closed to human review.');
assert.strictEqual(unknown.approvalRequired, true, 'An unknown model action must require owner approval.');
assert.strictEqual(unknown.canAutoSend, false, 'An unknown model action must never auto-send.');

const catalog = starTools.promptCatalog();
assert(catalog.reads.some(tool => tool.name === 'read_rental_file'), 'Star must have an explicit Rental File read capability.');
assert(catalog.actions.some(tool => tool.name === 'send_payment_link' && tool.access === 'draft_link'), 'Star must expose payment links only as typed draft-link work.');
assert(catalog.actions.some(tool => tool.name === 'customer_service_schedule' && tool.access === 'schedule'), 'Star must expose customer-service visits separately from mechanical maintenance.');
assert(catalog.actions.some(tool => tool.name === 'customer_service_review' && tool.access === 'human'), 'Customer complaints and account mismatches must route to staff care.');
assert(catalog.actions.every(tool => tool.access !== 'execute_money'), 'Star must not expose a direct money-execution tool.');

console.log('Star tools check passed: reads and drafts are allowlisted, sensitive actions require owner approval, and unknown actions fail closed.');
