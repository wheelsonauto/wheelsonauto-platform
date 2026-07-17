const crypto = require('crypto');

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function number(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function first(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && text(row[name]) !== '') return row[name];
  }
  return '';
}

function deepFirst(row, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, part) => current && current[part], row);
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  return '';
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload && payload.data,
    payload && payload.items,
    payload && payload.devices,
    payload && payload.assets,
    payload && payload.vehicles,
    payload && payload.results,
    payload && payload.records,
    payload && payload.data && payload.data.items,
    payload && payload.data && payload.data.devices,
    payload && payload.data && payload.data.assets,
    payload && payload.data && payload.data.vehicles,
    payload && payload.data && payload.data.results,
    payload && payload.response && payload.response.items,
    payload && payload.response && payload.response.devices
  ];
  return candidates.find(Array.isArray) || [];
}

function normalizePassTimeDevice(row = {}, options = {}) {
  const deviceId = text(first(row, ['deviceId', 'device_id', 'unitId', 'unit_id', 'serialNumber', 'serial_number', 'serial', 'imei', 'modemId', 'modem_id', 'id']));
  const vin = text(first(row, ['vin', 'VIN', 'vehicleVin', 'vehicle_vin']));
  const plate = text(first(row, ['plate', 'licensePlate', 'license_plate', 'tag', 'vehicleTag', 'vehicle_tag']));
  const vehicleId = text(first(row, ['vehicleId', 'vehicle_id', 'assetId', 'asset_id']));
  const status = text(first(row, ['status', 'deviceStatus', 'device_status', 'state', 'connectionStatus', 'connection_status'])) || 'Active';
  const lastPing = text(first(row, ['lastPing', 'last_ping', 'lastReport', 'last_report', 'lastCommunication', 'last_communication', 'reportedAt', 'reported_at', 'updatedAt', 'updated_at', 'timestamp']));
  const latitude = number(deepFirst(row, ['latitude', 'lat', 'location.latitude', 'location.lat', 'position.latitude', 'position.lat', 'lastLocation.latitude', 'lastLocation.lat']));
  const longitude = number(deepFirst(row, ['longitude', 'lng', 'lon', 'location.longitude', 'location.lng', 'location.lon', 'position.longitude', 'position.lng', 'position.lon', 'lastLocation.longitude', 'lastLocation.lng']));
  const location = text(deepFirst(row, ['address', 'location.address', 'location.label', 'position.address', 'lastLocation.address', 'lastLocation.label']));
  const providerEventId = text(first(row, ['eventId', 'event_id', 'locationId', 'location_id', 'reportId', 'report_id', 'updateId', 'update_id']));
  const fingerprint = [options.accountId, providerEventId, deviceId, vehicleId, vin, plate, lastPing, latitude, longitude].join('|');
  const eventId = providerEventId || 'passtime-' + crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
  return {
    eventId,
    providerEventId: providerEventId || eventId,
    provider: 'passtime',
    organizationId: text(options.organizationId),
    vehicleId,
    deviceId,
    tracker: deviceId,
    vin,
    plate,
    status,
    lastPing,
    location,
    latitude,
    longitude
  };
}

function createPassTimeClient(options = {}) {
  const baseUrl = text(options.baseUrl).replace(/\/+$/, '');
  const accountId = text(options.accountId);
  const devicesPath = text(options.devicesPath);
  const authMode = text(options.authMode || (options.token ? 'bearer' : (options.username && options.password ? 'basic' : (options.apiKey ? 'api-key' : '')))).toLowerCase();
  const apiKeyHeader = text(options.apiKeyHeader || 'x-api-key');
  const timeoutMs = Math.max(3000, Number(options.timeoutMs || 15000));

  function credentialReady() {
    if (authMode === 'bearer') return !!text(options.token);
    if (authMode === 'basic') return !!(text(options.username) && text(options.password));
    if (authMode === 'api-key') return !!text(options.apiKey || options.token);
    return false;
  }

  function readiness() {
    const missing = [];
    if (!baseUrl) missing.push('PASSTIME_API_BASE');
    if (!devicesPath) missing.push('PASSTIME_DEVICES_PATH');
    if (!credentialReady()) missing.push(authMode === 'basic' ? 'PASSTIME_API_USERNAME and PASSTIME_API_PASSWORD' : 'PASSTIME_API_TOKEN');
    return {
      provider: 'passtime',
      configured: missing.length === 0,
      readOnly: true,
      accountScoped: !!accountId,
      authMode: authMode || 'not configured',
      missing,
      status: missing.length ? 'PassTime API access needed' : 'PassTime API ready for live test'
    };
  }

  function headers() {
    const result = { Accept: 'application/json', 'User-Agent': 'WheelsonAuto-Platform/1.0' };
    if (authMode === 'bearer') result.Authorization = 'Bearer ' + text(options.token);
    if (authMode === 'basic') result.Authorization = 'Basic ' + Buffer.from(text(options.username) + ':' + text(options.password)).toString('base64');
    if (authMode === 'api-key') result[apiKeyHeader] = text(options.apiKey || options.token);
    if (accountId && options.accountHeader) result[text(options.accountHeader)] = accountId;
    return result;
  }

  function endpoint() {
    const expanded = devicesPath.replace(/\{accountId\}/g, encodeURIComponent(accountId));
    const url = new URL(expanded, baseUrl + '/');
    if (accountId && options.accountQueryParam && !url.searchParams.has(text(options.accountQueryParam))) {
      url.searchParams.set(text(options.accountQueryParam), accountId);
    }
    return url;
  }

  async function listDevices(requestOptions = {}) {
    const state = readiness();
    if (!state.configured) throw new Error('PassTime is not configured: ' + state.missing.join(', ') + '.');
    const fetchImpl = requestOptions.fetchImpl || options.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('PassTime sync needs a fetch implementation.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = endpoint();
      const response = await fetchImpl(url, { method: 'GET', headers: headers(), signal: controller.signal });
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) {
        const detail = text(first(payload, ['message', 'error', 'detail', 'title'])) || ('HTTP ' + response.status);
        const error = new Error('PassTime API request failed: ' + detail.slice(0, 240));
        error.statusCode = response.status;
        throw error;
      }
      const rows = extractRows(payload);
      if (!Array.isArray(rows)) throw new Error('PassTime API response did not contain a device list.');
      const events = rows.map(row => normalizePassTimeDevice(row, {
        accountId,
        organizationId: requestOptions.organizationId || options.organizationId
      })).filter(event => event.deviceId || event.vehicleId || event.vin || event.plate);
      return {
        provider: 'passtime',
        fetched: rows.length,
        usable: events.length,
        ignored: rows.length - events.length,
        events,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('PassTime API request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return { readiness, listDevices, normalizeDevice: row => normalizePassTimeDevice(row, { accountId, organizationId: options.organizationId }) };
}

module.exports = {
  createPassTimeClient,
  extractRows,
  normalizePassTimeDevice
};
