const assert = require('node:assert');
const { createPassTimeClient, extractRows, normalizePassTimeDevice } = require('../passtime-adapter');

(async () => {
  assert.strictEqual(extractRows({ data: { devices: [{ device_id: 'PT-100' }] } }).length, 1);

  const normalized = normalizePassTimeDevice({
    device_id: 'PT-100',
    vehicle_vin: 'VIN-PASSTIME-100',
    license_plate: 'NJ-PT100',
    device_status: 'Online',
    last_communication: '2026-07-17T14:00:00.000Z',
    location: { address: 'Blackwood, NJ', lat: 39.80, lng: -75.06 },
    report_id: 'report-100'
  }, { organizationId: 'org-wheelsonauto', accountId: 'dealer-1' });
  assert.strictEqual(normalized.deviceId, 'PT-100');
  assert.strictEqual(normalized.vin, 'VIN-PASSTIME-100');
  assert.strictEqual(normalized.plate, 'NJ-PT100');
  assert.strictEqual(normalized.status, 'Online');
  assert.strictEqual(normalized.location, 'Blackwood, NJ');
  assert.strictEqual(normalized.latitude, 39.8);
  assert.strictEqual(normalized.longitude, -75.06);
  assert.strictEqual(normalized.eventId, 'report-100');

  const noLocation = normalizePassTimeDevice({ deviceId: 'PT-NO-LOCATION' });
  assert.strictEqual(noLocation.latitude, null);
  assert.strictEqual(noLocation.longitude, null);

  let request = null;
  const client = createPassTimeClient({
    baseUrl: 'https://api.example.passtime.test/v1',
    devicesPath: '/accounts/{accountId}/devices',
    accountId: 'dealer-1',
    token: 'private-test-token',
    authMode: 'bearer',
    organizationId: 'org-wheelsonauto',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { devices: [
            { serialNumber: 'PT-200', VIN: 'VIN-PASSTIME-200', plate: 'NJ-PT200', status: 'Active', reportedAt: '2026-07-17T15:00:00.000Z', latitude: 39.81, longitude: -75.07 },
            { name: 'Unusable row without a vehicle identity' }
          ] } };
        }
      };
    }
  });
  assert.strictEqual(client.readiness().configured, true);
  assert.strictEqual(client.readiness().readOnly, true);
  const result = await client.listDevices();
  assert.strictEqual(request.url, 'https://api.example.passtime.test/accounts/dealer-1/devices');
  assert.strictEqual(request.options.headers.Authorization, 'Bearer private-test-token');
  assert.strictEqual(result.fetched, 2);
  assert.strictEqual(result.usable, 1);
  assert.strictEqual(result.ignored, 1);
  assert.strictEqual(result.events[0].deviceId, 'PT-200');
  assert.strictEqual(JSON.stringify(result).includes('private-test-token'), false);

  const basicClient = createPassTimeClient({
    baseUrl: 'https://api.example.passtime.test',
    devicesPath: '/devices',
    username: 'dealer-user',
    password: 'private-password',
    authMode: 'basic'
  });
  assert.strictEqual(basicClient.readiness().configured, true);

  const missing = createPassTimeClient({ authMode: 'bearer' }).readiness();
  assert.strictEqual(missing.configured, false);
  assert(missing.missing.includes('PASSTIME_API_BASE'));
  assert(missing.missing.includes('PASSTIME_DEVICES_PATH'));
  assert(missing.missing.includes('PASSTIME_API_TOKEN'));

  console.log('PassTime GPS adapter checks passed: read-only auth, response mapping, and credential redaction are enforced.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
