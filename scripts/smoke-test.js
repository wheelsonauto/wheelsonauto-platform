const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminPin = '1234';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function request(base, method, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (Object.prototype.hasOwnProperty.call(options, 'json')) {
    body = JSON.stringify(options.json);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(base + route, { method, headers, body, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {}
  return {
    status: res.status,
    text,
    json,
    cookie: res.headers.get('set-cookie') || '',
    location: res.headers.get('location') || ''
  };
}

async function waitForServer(base, child) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) fail('Server exited during startup.');
    try {
      const res = await fetch(base + '/login', { redirect: 'manual' });
      if (res.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fail('Server did not start within 15 seconds.');
}

async function login(base, form) {
  const res = await request(base, 'POST', '/login', { form });
  assert(res.status === 302, 'Expected login redirect, got ' + res.status + ': ' + res.text.slice(0, 120));
  assert(res.cookie.includes('woa_session='), 'Login did not set a session cookie.');
  return res.cookie.split(';')[0];
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-smoke-'));
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      WOA_ADMIN_PIN: adminPin,
      PORT: String(port),
      HOST: '127.0.0.1',
      WOA_AUTO_SYNC_MS: '3600000',
      WOA_AUTOPAY_MS: '3600000',
      WOA_AUTO_SYNC_STARTUP_DELAY_MS: '3600000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  try {
    await waitForServer(base, child);
    const loginPage = await request(base, 'GET', '/login');
    assert(loginPage.status === 200, 'Login page did not load.');
    assert(loginPage.text.includes('WheelsonAuto Portal'), 'Login page content is missing.');

    const ownerCookie = await login(base, { pin: adminPin });
    const state = await request(base, 'GET', '/api/state', { cookie: ownerCookie });
    assert(state.status === 200 && state.json, 'Owner could not read app state.');

    const applyPage = await request(base, 'GET', '/apply');
    assert(applyPage.status === 200 && applyPage.text.includes('WheelsonAuto'), 'Public application page did not load.');

    const publicApplication = await request(base, 'POST', '/api/public/applications', {
      json: {
        id: 'smoke-public-app',
        name: 'Smoke Applicant',
        phone: '3135550111',
        email: 'smoke-applicant@example.com',
        vehicleId: 'veh-001',
        vehicle: '2016 Ford Focus Hatch',
        income: 4500,
        down: 500
      }
    });
    assert(publicApplication.status === 201 && publicApplication.json.ok, 'Public application did not save.');
    const applicationState = await request(base, 'GET', '/api/state', { cookie: ownerCookie });
    const savedApplication = (applicationState.json.applications || []).find(app => app.id === 'smoke-public-app');
    const selectedVehicle = (applicationState.json.vehicles || []).find(vehicle => vehicle.id === 'veh-001');
    assert(savedApplication && savedApplication.stage === 'New', 'Public application is missing from admin state.');
    assert(selectedVehicle && selectedVehicle.status === 'Pending application', 'Public vehicle status did not move to Pending application.');

    const mechanic = await request(base, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'smoke-mechanic',
        name: 'Smoke Mechanic',
        username: 'smoke-mechanic',
        password: 'SmokeMechanic123!',
        role: 'Mechanic',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7811'
      }
    });
    assert(mechanic.status === 200 && mechanic.json.ok, 'Owner could not create mechanic account.');

    const manager = await request(base, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'smoke-manager',
        name: 'Smoke Manager',
        username: 'smoke-manager',
        password: 'SmokeManager123!',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7822'
      }
    });
    assert(manager.status === 200 && manager.json.ok, 'Owner could not create manager account.');

    const mechanicCookie = await login(base, { username: 'smoke-mechanic', password: 'SmokeMechanic123!' });
    const managerCookie = await login(base, { username: 'smoke-manager', password: 'SmokeManager123!' });

    const managerMessage = await request(base, 'POST', '/api/messages/send', {
      cookie: managerCookie,
      json: { customer: 'Smoke Customer', phone: '3135550199', body: 'Smoke test manager message.' }
    });
    assert([200, 202].includes(managerMessage.status) && managerMessage.json.ok, 'Manager could not save/send a message.');

    const mechanicMessage = await request(base, 'POST', '/api/messages/send', {
      cookie: mechanicCookie,
      json: { customer: 'Smoke Customer', phone: '3135550199', body: 'Smoke test mechanic message.' }
    });
    assert(mechanicMessage.status === 403, 'Mechanic message API should be blocked, got ' + mechanicMessage.status + '.');

    const beforeState = await request(base, 'GET', '/api/state', { cookie: ownerCookie });
    const beforeCount = (beforeState.json.messages || []).length;
    const injectedMessageId = 'mechanic-injected-message';
    const mechanicStateWrite = await request(base, 'PUT', '/api/state', {
      cookie: mechanicCookie,
      json: { messages: [{ id: injectedMessageId, customer: 'Should Not Save', body: 'Blocked write' }] }
    });
    assert(mechanicStateWrite.status === 200 && mechanicStateWrite.json.ok, 'Mechanic state write should save allowed fields only.');
    const afterState = await request(base, 'GET', '/api/state', { cookie: ownerCookie });
    const afterMessages = afterState.json.messages || [];
    assert(afterMessages.length === beforeCount, 'Mechanic state write changed message count.');
    assert(!afterMessages.some(message => message.id === injectedMessageId), 'Mechanic state write injected a message.');

    const mechanicAutopay = await request(base, 'POST', '/api/recurring-payments', {
      cookie: mechanicCookie,
      json: { customer: 'Blocked Autopay', amount: 1 }
    });
    assert(mechanicAutopay.status === 403, 'Mechanic recurring payment API should be blocked.');

    const managerAutopay = await request(base, 'POST', '/api/recurring-payments', {
      cookie: managerCookie,
      json: { customer: 'Blocked Manager Autopay', amount: 1 }
    });
    assert(managerAutopay.status === 403, 'Manager recurring payment API should be blocked.');

    const managerCardSetup = await request(base, 'POST', '/api/card-setup-requests', {
      cookie: managerCookie,
      json: { customer: 'Blocked Manager Card Setup', amount: 1, frequency: 'Weekly' }
    });
    assert(managerCardSetup.status === 403, 'Manager card setup API should be blocked.');

    const mechanicCardSetup = await request(base, 'POST', '/api/card-setup-requests', {
      cookie: mechanicCookie,
      json: { customer: 'Blocked Mechanic Card Setup', amount: 1, frequency: 'Weekly' }
    });
    assert(mechanicCardSetup.status === 403, 'Mechanic card setup API should be blocked.');

    const paymentLink = await request(base, 'POST', '/api/payment-links', {
      cookie: ownerCookie,
      json: {
        customer: 'Smoke Payment Customer',
        phone: '3135550122',
        email: 'smoke-pay@example.com',
        vehicle: '2016 Ford Focus Hatch',
        amount: 12,
        frequency: 'Weekly'
      }
    });
    assert(paymentLink.status === 201 && paymentLink.json.ok && paymentLink.json.paymentLink.id, 'Owner payment link did not save.');
    const publicPay = await request(base, 'GET', '/pay/' + paymentLink.json.paymentLink.id);
    assert(publicPay.status === 200 && publicPay.text.includes('Smoke Payment Customer') && publicPay.text.includes('Pay securely with Clover'), 'Public payment link did not render.');
    const missingPay = await request(base, 'GET', '/pay/missing-smoke-link');
    assert(missingPay.status === 404 && missingPay.text.includes('Payment link not found'), 'Missing payment link should show a 404 page.');

    const cardSetup = await request(base, 'POST', '/api/card-setup-requests', {
      cookie: ownerCookie,
      json: {
        customer: 'Smoke Card Customer',
        phone: '3135550133',
        email: 'smoke-card@example.com',
        vehicleId: 'veh-001',
        amount: 13,
        frequency: 'Weekly',
        firstRun: '2026-07-18',
        chargeTime: '18:00'
      }
    });
    assert(cardSetup.status === 201 && cardSetup.json.ok && cardSetup.json.setupLink.id, 'Owner card setup link did not save.');
    const publicSetup = await request(base, 'GET', '/setup-card/' + cardSetup.json.setupLink.id);
    assert(publicSetup.status === 200 && publicSetup.text.includes('Set up automatic payments') && publicSetup.text.includes('Smoke Card Customer'), 'Public card setup link did not render.');
    const missingSetup = await request(base, 'GET', '/setup-card/missing-smoke-setup');
    assert(missingSetup.status === 404 && missingSetup.text.includes('Card setup link not found'), 'Missing card setup link should show a 404 page.');

    const messageStatus = await request(base, 'GET', '/api/messages/status', { cookie: managerCookie });
    assert(messageStatus.status === 200 && messageStatus.json.ok, 'Manager should read messaging status.');

    console.log('Smoke tests passed: login, role accounts, public application, payment/card setup links, messaging permissions, state write guard, and payment API guard.');
  } catch (err) {
    console.error(output);
    throw err;
  } finally {
    child.kill('SIGTERM');
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
