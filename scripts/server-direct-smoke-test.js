const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
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

class MockRequest extends Readable {
  constructor(method, url, headers, body) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers || {};
    this._body = body ? Buffer.from(body) : Buffer.alloc(0);
    this._sent = false;
  }
  _read() {
    if (this._sent) return;
    this._sent = true;
    if (this._body.length) this.push(this._body);
    this.push(null);
  }
}

class MockResponse {
  constructor(done) {
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
    this._done = done;
  }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  end(body = '') {
    this.body += Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
    this._done({
      status: this.statusCode,
      text: this.body,
      json: parseJson(this.body),
      cookie: this.headers['Set-Cookie'] || this.headers['set-cookie'] || '',
      location: this.headers.Location || this.headers.location || ''
    });
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function cleanCookie(raw) {
  return String(raw || '').split(';')[0];
}

async function request(server, method, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = '';
  if (options.cookie) headers.cookie = options.cookie;
  if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (Object.prototype.hasOwnProperty.call(options, 'json')) {
    body = JSON.stringify(options.json);
    headers['content-type'] = 'application/json';
  }
  headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, headers, body);
    const res = new MockResponse(resolve);
    try {
      server.emit('request', req, res);
    } catch (err) {
      reject(err);
    }
  });
}

async function login(server, form) {
  const res = await request(server, 'POST', '/login', { form });
  assert(res.status === 302, 'Expected login redirect, got ' + res.status + ': ' + res.text.slice(0, 120));
  assert(String(res.cookie).includes('woa_session='), 'Login did not set a session cookie.');
  return cleanCookie(res.cookie);
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-direct-smoke-'));
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = adminPin;
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.PUBLIC_BASE_URL = 'https://wheelsonauto-platform.onrender.com';
  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');

  try {
    const loginPage = await request(server, 'GET', '/login');
    assert(loginPage.status === 200, 'Login page did not load.');
    assert(loginPage.text.includes('WheelsonAuto Portal'), 'Login page content is missing.');

    const ownerCookie = await login(server, { pin: adminPin });
    const ownerState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(ownerState.status === 200 && ownerState.json, 'Owner could not read state.');

    const duplicateState = JSON.parse(JSON.stringify(ownerState.json));
    duplicateState.vehicles = duplicateState.vehicles || [];
    duplicateState.vehicles.push(
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate One', vin: 'DIRECTVIN001', plate: 'DIR-001', status: 'Ready' },
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate Two', vin: 'DIRECTVIN002', plate: 'DIR-002', status: 'Ready' }
    );
    const duplicateWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: duplicateState });
    assert(duplicateWrite.status === 200 && duplicateWrite.json.ok, 'Owner state write failed.');
    const duplicateRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const duplicateRows = (duplicateRead.json.vehicles || []).filter(vehicle => String(vehicle.name || '').startsWith('Direct Duplicate'));
    assert(duplicateRows.length === 2, 'Duplicate ID repair should preserve both rows.');
    assert(new Set(duplicateRows.map(vehicle => vehicle.id)).size === 2, 'Duplicate ID repair should make unique vehicle IDs.');

    const publicApplication = await request(server, 'POST', '/api/public/applications', {
      json: {
        id: 'direct-public-app',
        name: 'Direct Applicant',
        phone: '3135550111',
        email: 'direct-applicant@example.com',
        vehicleId: 'veh-001',
        vehicle: '2016 Ford Focus Hatch',
        income: 4500,
        down: 500
      }
    });
    assert(publicApplication.status === 201 && publicApplication.json.ok, 'Public application did not save.');

    const mechanic = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-mechanic',
        name: 'Direct Mechanic',
        username: 'direct-mechanic',
        password: 'DirectMechanic123!',
        role: 'Mechanic',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7811'
      }
    });
    assert(mechanic.status === 200 && mechanic.json.ok, 'Owner could not create mechanic.');

    const manager = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-manager',
        name: 'Direct Manager',
        username: 'direct-manager',
        password: 'DirectManager123!',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7822'
      }
    });
    assert(manager.status === 200 && manager.json.ok, 'Owner could not create manager.');

    const mechanicCookie = await login(server, { username: 'direct-mechanic', password: 'DirectMechanic123!' });
    const managerCookie = await login(server, { username: 'direct-manager', password: 'DirectManager123!' });

    const managerMessage = await request(server, 'POST', '/api/messages/send', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', phone: '3135550199', body: 'Direct smoke manager message.' }
    });
    assert([200, 202].includes(managerMessage.status) && managerMessage.json.ok, 'Manager SMS message failed.');

    const managerEmail = await request(server, 'POST', '/api/messages/send', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', email: 'direct-customer@example.com', channel: 'Email', body: 'Direct smoke email message.' }
    });
    assert([200, 202].includes(managerEmail.status) && managerEmail.json.ok, 'Manager email draft/send failed.');
    assert(managerEmail.json.message.channel === 'Email', 'Email message should be saved as Email channel.');

    const inboundEmail = await request(server, 'POST', '/api/webhooks/email', {
      headers: { 'x-woa-webhook-secret': '' },
      json: {
        id: 'direct-email-001',
        from: 'Direct Customer <direct-customer@example.com>',
        to: 'office@wheelsonauto.com',
        subject: 'Payment question',
        text: 'Can you send me my payment link?'
      }
    });
    assert(inboundEmail.status === 200 && inboundEmail.json.ok && inboundEmail.json.received, 'Inbound email webhook failed.');

    const starDraft = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', email: 'direct-customer@example.com', channel: 'Email', body: 'What time can I come in for service?' }
    });
    assert(starDraft.status === 201 && starDraft.json.ok, 'Manager could not create Star draft.');
    assert(starDraft.json.draft.deliveryChannel === 'Email', 'Star draft should preserve Email delivery channel.');
    assert(starDraft.json.plan.canAutoSend === true, 'Safe Star service reply should be auto-ready.');

    const starSend = await request(server, 'POST', '/api/messages/ai-action', {
      cookie: managerCookie,
      json: { draftId: starDraft.json.draft.id, channel: 'Email' }
    });
    assert([200, 202].includes(starSend.status) && starSend.json.ok, 'Star email approval failed.');

    const mechanicMessage = await request(server, 'POST', '/api/messages/send', {
      cookie: mechanicCookie,
      json: { customer: 'Blocked', phone: '3135550199', body: 'Should not save.' }
    });
    assert(mechanicMessage.status === 403, 'Mechanic message API should be blocked.');

    const mechanicAutopay = await request(server, 'POST', '/api/recurring-payments', {
      cookie: mechanicCookie,
      json: { customer: 'Blocked Autopay', amount: 1 }
    });
    assert(mechanicAutopay.status === 403, 'Mechanic recurring payment API should be blocked.');

    const managerState = await request(server, 'GET', '/api/state', { cookie: managerCookie });
    assert(managerState.status === 200 && Array.isArray(managerState.json.messages), 'Manager should see message state.');
    assert(managerState.json.messages.some(message => message.channel === 'Email'), 'Manager state should include email history.');

    const mechanicState = await request(server, 'GET', '/api/state', { cookie: mechanicCookie });
    assert(mechanicState.status === 200 && mechanicState.json, 'Mechanic state should load.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'messages'), 'Mechanic state should not include messages.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'payments'), 'Mechanic state should not include payments.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'recurringPayments'), 'Mechanic state should not include recurring payments.');

    const status = await request(server, 'GET', '/api/messages/status', { cookie: managerCookie });
    assert(status.status === 200 && status.json.messaging.emailWebhookUrl, 'Messaging status should expose email webhook.');

    console.log('Direct server smoke passed: login, state repair, public application, role filters, SMS/email messages, inbound email webhook, Star email approval, and staff permissions.');
  } finally {
    try { server.close(); } catch (_) {}
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
