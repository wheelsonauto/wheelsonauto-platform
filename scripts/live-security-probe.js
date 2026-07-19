const assert = require('node:assert/strict');
const { firstUserArgument } = require('./cli-arguments');

const target = String(firstUserArgument() || process.env.WOA_LIVE_PROBE_BASE_URL || '').trim().replace(/\/+$/, '');
if (!/^https:\/\//i.test(target)) {
  console.error('Usage: node scripts/live-security-probe.js https://your-wheelsonauto-host');
  process.exit(2);
}

async function request(pathname) {
  const separator = pathname.includes('?') ? '&' : '?';
  return fetch(target + pathname + separator + 'security_probe=' + Date.now(), {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'User-Agent': 'WheelsonAuto-Live-Security-Probe/1.0'
    },
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

async function expectStatus(pathname, expected, label) {
  const response = await request(pathname);
  assert.equal(response.status, expected, label + ' returned HTTP ' + response.status + ' instead of ' + expected + '.');
  assertSecurityHeaders(response, label);
  return response;
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
  await expectStatus('/api/onboarding/documents/security-probe-does-not-exist', 401, 'Private identity document');
  await expectStatus('/api/onboarding/signatures/security-probe-does-not-exist', 401, 'Private signature');
  await expectStatus('/api/contract-template', 401, 'Editable contract template');

  const customerDocument = await expectStatus('/customer/documents/security-probe-does-not-exist', 302, 'Customer private document');
  assert.equal(customerDocument.headers.get('location'), '/customer/login', 'An unauthenticated customer document request must return to customer login.');
  assert.equal(customerDocument.headers.get('cache-control'), 'no-store', 'The customer document redirect must not be cached.');

  console.log('Live security probe passed for ' + target + ': release ' + healthBody.release + ' at ' + healthBody.commit + ' rejects anonymous state, preflight, contract, identity-document, signature, and customer-document access with hardened response headers.');
}

main().catch(error => {
  console.error('Live security probe failed:', error && error.message || error);
  process.exit(1);
});
