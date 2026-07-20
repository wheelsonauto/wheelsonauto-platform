'use strict';

const assert = require('node:assert/strict');
const { isTransientRenderRoutingError, requestWithRenderRetry } = require('../live-probe-request');

function response(status, routing = '') {
  return {
    status,
    headers: new Headers(routing ? { 'x-render-routing': routing } : {}),
    body: {
      cancel: async () => {}
    }
  };
}

async function main() {
  assert.equal(isTransientRenderRoutingError(response(502, 'dynamic-paid-error')), true);
  assert.equal(isTransientRenderRoutingError(response(503, 'service-error')), true);
  assert.equal(isTransientRenderRoutingError(response(401, 'dynamic-paid-error')), false);
  assert.equal(isTransientRenderRoutingError(response(502, 'dynamic')), false);
  assert.equal(isTransientRenderRoutingError(response(502)), false);

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
