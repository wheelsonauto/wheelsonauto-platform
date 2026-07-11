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

    const messageStatus = await request(base, 'GET', '/api/messages/status', { cookie: managerCookie });
    assert(messageStatus.status === 200 && messageStatus.json.ok, 'Manager should read messaging status.');

    console.log('Smoke tests passed: login, role accounts, messaging permissions, state write guard, and payment API guard.');
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
