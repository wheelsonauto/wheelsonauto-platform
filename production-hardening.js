'use strict';

const LIVE_RENDER_SERVICE_ID = 'srv-d92shoeh2hms73cqcdgg';
const LIVE_RENDER_HOSTNAME = 'wheelsonauto-platform.onrender.com';

function normalizedHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function isLiveRenderProductionService(environment = process.env) {
  return String(environment.RENDER_SERVICE_ID || '').trim() === LIVE_RENDER_SERVICE_ID &&
    normalizedHostname(environment.RENDER_EXTERNAL_HOSTNAME) === LIVE_RENDER_HOSTNAME &&
    normalizedHostname(environment.PUBLIC_BASE_URL) === LIVE_RENDER_HOSTNAME;
}

function productionHardeningRequired(environment = process.env) {
  return String(environment.WOA_PRODUCTION_HARDENING_REQUIRED || '').trim() === '1' ||
    isLiveRenderProductionService(environment);
}

module.exports = {
  LIVE_RENDER_HOSTNAME,
  LIVE_RENDER_SERVICE_ID,
  isLiveRenderProductionService,
  normalizedHostname,
  productionHardeningRequired
};
