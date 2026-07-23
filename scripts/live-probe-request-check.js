'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isTransientRenderRoutingError, requestWithRenderRetry } = require('../live-probe-request');

function response(status, routing = '', additionalHeaders = {}) {
  return {
    status,
    headers: new Headers({
      ...(routing ? { 'x-render-routing': routing } : {}),
      ...additionalHeaders
    }),
    body: {
      cancel: async () => {}
    }
  };
}

async function main() {
  const securityProbeSource = fs.readFileSync(path.join(__dirname, 'live-security-probe.js'), 'utf8');
  [
    '/api/onboarding/review',
    '/api/card-setup-requests',
    '/api/payment-links',
    '/api/integrations/stripe/readiness',
    '/api/integrations/payments/manual-charge',
    '/api/integrations/payments/refunds/prepare',
    '/api/integrations/payments/refunds/execute',
    '/api/integrations/payments/refunds/complete-manual',
    '/api/payment-provider/review/resolve',
    '/api/payment-provider/duplicate-review/resolve',
    '/api/integrations/payments/disputes/action',
    '/api/verification/document',
    '/api/onboarding/contracts/security-probe-does-not-exist',
    '/api/contract-template',
    '/api/woa-autopay/status',
    '/api/woa-autopay/run',
    '/api/system/infrastructure/document-storage/validate',
    '/api/system/infrastructure/state-backup/create',
    '/api/system/infrastructure/state-backup/verify',
    '/api/system/recovery/restore',
    '/api/integrations/telnyx/readiness',
    '/api/messages/ai-health',
    '/api/notifications/email/test'
  ].forEach(route => {
    assert.ok(securityProbeSource.includes("'" + route + "'"), 'Live security probe must cover the launch-critical boundary ' + route + '.');
  });
  assert.ok(securityProbeSource.includes("'/customer/contracts/security-probe-does-not-exist'"), 'Live security probe must verify that signed-agreement pages redirect anonymous customers to customer login.');

  assert.equal(isTransientRenderRoutingError(response(502, 'dynamic-paid-error')), true);
  assert.equal(isTransientRenderRoutingError(response(503, 'service-error')), true);
  assert.equal(isTransientRenderRoutingError(response(401, 'dynamic-paid-error')), false);
  assert.equal(isTransientRenderRoutingError(response(502, 'dynamic')), false);
  assert.equal(isTransientRenderRoutingError(response(502)), false);
  assert.equal(isTransientRenderRoutingError(response(502, '', {
    'content-type': 'text/html; charset=utf-8',
    server: 'cloudflare',
    'x-render-origin-server': 'Render'
  })), true, 'A Render-generated HTML edge page without WheelsonAuto security headers should retry.');
  assert.equal(isTransientRenderRoutingError(response(502, '', {
    'content-type': 'text/html; charset=utf-8',
    server: 'cloudflare',
    'x-render-origin-server': 'Render',
    'content-security-policy': "default-src 'self'"
  })), false, 'An application response carrying WheelsonAuto security headers must remain visible.');

  let calls = 0;
  const recovered = await requestWithRenderRetry('https://example.invalid', {}, {
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? response(502, 'dynamic-paid-error') : response(401, 'dynamic');
    },
    delay: async () => {}
  });
  assert.equal(recovered.status, 401, 'A confirmed Render routing error should retry and return the recovered application response.');
  assert.equal(calls, 3, 'The live probe should retry a confirmed Render routing error at most twice.');

  calls = 0;
  const applicationFailure = await requestWithRenderRetry('https://example.invalid', {}, {
    fetchImpl: async () => {
      calls += 1;
      return response(502, 'dynamic');
    },
    delay: async () => {}
  });
  assert.equal(applicationFailure.status, 502);
  assert.equal(calls, 1, 'An application or unexplained 502 must fail without being hidden by retries.');

  calls = 0;
  const exhausted = await requestWithRenderRetry('https://example.invalid', {}, {
    fetchImpl: async () => {
      calls += 1;
      return response(504, 'dynamic-paid-error');
    },
    delay: async () => {},
    maxAttempts: 9
  });
  assert.equal(exhausted.status, 504);
  assert.equal(calls, 3, 'Render retries must stay bounded at three total attempts.');

  console.log('Live probe request check passed: confirmed Render edge handoff errors retry twice, while app and unexplained failures remain visible.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
