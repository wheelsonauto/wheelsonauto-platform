'use strict';

const TRANSIENT_RENDER_STATUSES = new Set([502, 503, 504]);

function isTransientRenderRoutingError(response) {
  if (!response || !TRANSIENT_RENDER_STATUSES.has(Number(response.status))) return false;
  const header = name => String(response.headers?.get?.(name) || '');
  if (/error/i.test(header('x-render-routing'))) return true;

  const isRenderHtmlEdgePage = /text\/html/i.test(header('content-type'))
    && !/default-src\s+'self'/i.test(header('content-security-policy'))
    && (/render/i.test(header('x-render-origin-server')) || /cloudflare/i.test(header('server')));
  return isRenderHtmlEdgePage;
}

async function requestWithRenderRetry(url, options, configuration = {}) {
  const fetchImpl = configuration.fetchImpl || fetch;
  const delay = configuration.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const maxAttempts = Math.max(1, Math.min(3, Number(configuration.maxAttempts) || 3));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, options);
    if (!isTransientRenderRoutingError(response) || attempt === maxAttempts) return response;

    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    await delay(attempt * 500);
  }

  throw new Error('Render retry loop ended without a response.');
}

module.exports = {
  isTransientRenderRoutingError,
  requestWithRenderRetry
};
