'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const node = process.execPath;

const matrix = [
  ['live business data remains unstaged', 'scripts/protect-live-data-check.js'],
  ['production environment and provider-mode validation', 'scripts/production-environment-check.js'],
  ['production startup fails closed until every launch proof is current', 'scripts/production-startup-gate-check.js'],
  ['aggregate production launch audit stays complete and provider-safe', 'scripts/production-readiness-audit-check.js'],
  ['live provider proofs are configuration-bound and cannot be forged by browser state', 'scripts/provider-launch-proof-check.js'],
  ['production PostgreSQL, storage, backup, and alert foundation', 'scripts/production-foundation-check.js'],
  ['controlled JSON-to-PostgreSQL cutover never reopens stale JSON', 'scripts/data-backend-cutover-check.js'],
  ['signed maintenance-frozen PostgreSQL migration source provenance', 'scripts/postgres-migration-source-check.js'],
  ['password-only owner cutover and session revocation', 'scripts/owner-auth-runtime-check.js'],
  ['fatal process monitoring and owner alerts', 'scripts/fatal-process-monitor-check.js'],
  ['protected recovery state and session revocation', 'scripts/recovery-guard-check.js'],
  ['encrypted offsite backup creation', 'scripts/encrypted-state-backup-check.js'],
  ['encrypted backup restore and tamper rejection', 'scripts/encrypted-state-recovery-check.js'],
  ['transactional PostgreSQL runtime and restart recovery', 'scripts/postgres-runtime-check.js'],
  ['guarded isolated PostgreSQL recovery-drill orchestration', 'scripts/postgres-recovery-drill-runner-check.js'],
  ['private object storage read/write/delete safeguards', 'scripts/object-storage-runtime-check.js'],
  ['private document metadata and object atomicity', 'scripts/private-document-atomicity-check.js'],
  ['legacy private-document migration, read-back, and repeat safety', 'scripts/private-document-migration-check.js'],
  ['cross-company PostgreSQL and document isolation', 'scripts/postgres-tenant-privacy-check.js'],
  ['public bearer-link expiry, revocation, and privacy', 'scripts/public-link-security-check.js'],
  ['Stripe saved-card charges, declines, refunds, and disputes', 'scripts/stripe-payment-check.js'],
  ['Stripe timeout, late, duplicate, and out-of-order reconciliation', 'scripts/stripe-timeout-reconciliation-check.js'],
  ['autopay restart recovery and one-hour retry lifecycle', 'scripts/autopay-restart-check.js'],
  ['Stripe Identity license and selfie lifecycle', 'scripts/stripe-identity-check.js'],
  ['application, insurance, deposit, first payment, e-sign, pickup, and weekly anchor', 'scripts/stripe-onboarding-lifecycle-check.js'],
  ['native application and customer onboarding surfaces', 'scripts/native-onboarding-check.js'],
  ['Telnyx signed inbound, delivery, 10DLC, and number assignment', 'scripts/telnyx-messaging-check.js'],
  ['SMS and email consent, STOP, START, and HELP handling', 'scripts/messaging-consent-check.js'],
  ['Star provider limits, safe drafts, and admin approvals', 'scripts/star-provider-runtime-check.js'],
  ['vehicle swaps, returns, ended customers, and reactivation', 'scripts/customer-fleet-workflow-check.js'],
  ['admin, manager, mechanic, and customer role boundaries', 'scripts/role-access-check.js'],
  ['phone, tablet, laptop, wide desktop, modal, and no-blur guards', 'scripts/responsive-style-check.js'],
  ['rendered role portals, heavy views, searches, and modals', 'scripts/frontend-render-smoke-test.js'],
  ['repository and deploy configuration contain no production secrets', 'scripts/secret-hygiene-check.js'],
  ['authentication, rate limits, document privacy, money workflows, and API boundaries', 'scripts/server-direct-smoke-test.js']
];

function run(label, script) {
  const result = spawnSync(node, [script], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, WOA_LAUNCH_HARD_TEST_MATRIX: '1' }
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('').trim();
  if (result.status !== 0) {
    throw new Error(label + ' failed' + (output ? ':\n' + output : '.'));
  }
  console.log('ok - ' + label);
}

for (const [label, script] of matrix) run(label, script);

console.log(
  'Launch hard-test matrix passed: ' + matrix.length +
  ' production launch areas verified without staging or rewriting live business data.'
);
