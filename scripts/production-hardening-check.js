'use strict';

const assert = require('node:assert/strict');
const {
  LIVE_RENDER_HOSTNAME,
  LIVE_RENDER_SERVICE_ID,
  isLiveRenderProductionService,
  normalizedHostname,
  productionHardeningRequired
} = require('../production-hardening');

const liveEnvironment = {
  RENDER_SERVICE_ID: LIVE_RENDER_SERVICE_ID,
  RENDER_EXTERNAL_HOSTNAME: LIVE_RENDER_HOSTNAME,
  PUBLIC_BASE_URL: 'https://' + LIVE_RENDER_HOSTNAME + '/',
  WOA_PRODUCTION_HARDENING_REQUIRED: '0'
};

assert.equal(normalizedHostname('https://WheelsonAuto-Platform.OnRender.com/'), LIVE_RENDER_HOSTNAME);
assert.equal(isLiveRenderProductionService(liveEnvironment), true);
assert.equal(productionHardeningRequired(liveEnvironment), false, 'The staged proof pass must continue to honor the explicit disabled hardening value.');
assert.equal(productionHardeningRequired({ WOA_PRODUCTION_HARDENING_REQUIRED: '1' }), true);
assert.equal(productionHardeningRequired({ WOA_PRODUCTION_HARDENING_REQUIRED: '0' }), false);

for (const key of ['RENDER_SERVICE_ID', 'RENDER_EXTERNAL_HOSTNAME', 'PUBLIC_BASE_URL']) {
  assert.equal(
    isLiveRenderProductionService({ ...liveEnvironment, [key]: 'different-value' }),
    false,
    'Live production detection must fail closed when ' + key + ' does not match.'
  );
}

console.log('Production hardening check passed: exact live-service detection and the explicit startup gate are independently verified.');
