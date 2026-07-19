const assert = require('node:assert/strict');
const { firstUserArgument } = require('./cli-arguments');

const target = String(firstUserArgument() || process.env.WOA_LIVE_PROBE_BASE_URL || '').trim().replace(/\/+$/, '');
if (!/^https:\/\//i.test(target)) {
  console.error('Usage: node scripts/live-security-probe.js https://your-wheelsonauto-host');
  process.exit(2);
}

async function request(pathname, method = 'GET') {
  const separator = pathname.includes('?') ? '&' : '?';
  return fetch(target + pathname + separator + 'security_probe=' + Date.now(), {
    method,
    redirect: 'manual',
    headers: {
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      'User-Agent': 'WheelsonAuto-Live-Security-Probe/1.0'
    },
    ...(method === 'GET' ? {} : { body: '{}' }),
    signal: AbortSignal.timeout(15000)
  });
}

function assertSecurityHeaders(response, label) {
  const csp = String(response.headers.get('content-security-policy') || '');
  assert.match(csp, /default-src\s+'self'/, label + ' must send the application Content-Security-Policy.');
  assert.equal(response.headers.get('x-frame-options'), 'DENY', label + ' must reject framing.');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', label + ' must disable MIME sniffing.');
  assert.match(String(response.headers.get('strict-transport-security') || ''), /max-age=31536000/, label + ' must enforce HTTPS transport security.');
  assert.ok(response.headers.get('referrer-policy'), label + ' must define a referrer policy.');
}

async function expectStatus(pathname, expected, label, method = 'GET') {
  const response = await request(pathname, method);
  assert.equal(response.status, expected, label + ' returned HTTP ' + response.status + ' instead of ' + expected + '.');
  assertSecurityHeaders(response, label);
  return response;
}

const anonymousProtectedRoutes = [
  ['GET', '/api/customer/portal-state', 'Customer portal state'],
  ['POST', '/api/customer-accounts', 'Customer account administration'],
  ['POST', '/api/organizations', 'Company administration'],
  ['GET', '/api/messages/status', 'Messaging staff status'],
  ['POST', '/api/messages/ai-action', 'Star approval action'],
  ['GET', '/api/reports/deep.csv', 'Deep business report'],
  ['GET', '/api/accounting/ledger', 'Accounting ledger'],
  ['GET', '/api/billing/summary', 'Company billing summary'],
  ['GET', '/api/verification/status', 'Verification and insurance cases'],
  ['GET', '/api/integrations/tracker/status', 'Tracker status'],
  ['GET', '/api/integrations/marketing/status', 'Marketing status'],
  ['GET', '/api/pickups/calendar', 'Pickup calendar'],
  ['GET', '/api/integrations/clover/reconciliation', 'Clover reconciliation'],
  ['POST', '/api/integrations/payments/refunds/execute', 'Refund execution'],
  ['POST', '/api/payment-provider/switch', 'Payment-provider cutover'],
  ['POST', '/api/woa-autopay/run', 'Autopay execution']
];

async function expectAnonymousApiBoundary(method, pathname, label) {
  const response = await expectStatus(pathname, 401, label, method);
  assert.match(String(response.headers.get('cache-control') || ''), /no-store/i, label + ' authentication failure must not be cached.');
  const body = await response.json();
  assert.equal(body.ok, false, label + ' must return a failed JSON result.');
  assert.match(String(body.error || ''), /(?:authentication|login) required/i, label + ' must fail at authentication before reading or changing business data.');
  assert.deepEqual(Object.keys(body).sort(), ['error', 'ok'], label + ' anonymous response must not leak route or business metadata.');
}

async function expectMissingBearerLink(pathname, label, token) {
  const response = await expectStatus(pathname, 404, label);
  assert.match(String(response.headers.get('cache-control') || ''), /private.*no-store|no-store.*private/i, label + ' must never be cached.');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer', label + ' must not send its bearer token in a referrer.');
  assert.match(String(response.headers.get('x-robots-tag') || ''), /noindex.*nofollow/i, label + ' must stay out of search indexes.');
  const body = await response.text();
  assert.equal(body.includes(token), false, label + ' must not echo the attempted bearer token.');
  assert.doesNotMatch(body, /customer|vehicle|vin|card ending|amount due/i, label + ' missing-link response must not expose business details.');
}

async function main() {
  const health = await expectStatus('/healthz', 200, 'Health route');
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true, 'Health route must report ok.');
  assert.match(String(healthBody.release || ''), /^platform-/, 'Health route must expose the release identifier.');
  assert.ok(String(healthBody.commit || '').trim(), 'Health route must expose the deployed commit.');

  await expectStatus('/login', 200, 'Staff login');
  await expectStatus('/api/state', 401, 'Dashboard state');
  await expectStatus('/api/system/infrastructure/preflight', 401, 'Owner launch preflight');
  await expectStatus('/api/system/recovery/snapshots', 401, 'Owner recovery history');
  await expectStatus('/api/system/recovery/restore', 401, 'Owner recovery restore', 'POST');
  await expectStatus('/api/onboarding/documents/security-probe-does-not-exist', 401, 'Private identity document');
  await expectStatus('/api/onboarding/signatures/security-probe-does-not-exist', 401, 'Private signature');
  await expectStatus('/api/contract-template', 401, 'Editable contract template');
  for (const [method, pathname, label] of anonymousProtectedRoutes) {
    await expectAnonymousApiBoundary(method, pathname, label);
  }

  const paymentToken = 'plink-' + 'a'.repeat(48);
  const setupToken = 'setup-' + 'b'.repeat(48);
  const onboardingToken = 'c'.repeat(56);
  const tollToken = 'd'.repeat(48);
  await expectMissingBearerLink('/pay/' + paymentToken, 'Missing payment bearer link', paymentToken);
  await expectMissingBearerLink('/setup-card/' + setupToken, 'Missing card-setup bearer link', setupToken);
  await expectMissingBearerLink('/onboard/' + onboardingToken, 'Missing onboarding bearer link', onboardingToken);
  await expectMissingBearerLink('/toll-receipt/' + tollToken, 'Missing toll-receipt bearer link', tollToken);

  const customerDocument = await expectStatus('/customer/documents/security-probe-does-not-exist', 302, 'Customer private document');
  assert.equal(customerDocument.headers.get('location'), '/customer/login', 'An unauthenticated customer document request must return to customer login.');
  assert.equal(customerDocument.headers.get('cache-control'), 'no-store', 'The customer document redirect must not be cached.');

  console.log('Live security probe passed for ' + target + ': release ' + healthBody.release + ' at ' + healthBody.commit + ' rejects anonymous access across ' + anonymousProtectedRoutes.length + ' staff/customer API boundaries, protects four public bearer-link families, and guards state, preflight, recovery, contract, identity-document, signature, and customer-document routes with hardened response headers.');
}

main().catch(error => {
  console.error('Live security probe failed:', error && error.message || error);
  process.exit(1);
});
