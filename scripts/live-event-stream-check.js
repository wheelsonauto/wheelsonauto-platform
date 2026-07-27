const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitFor(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for ' + label + '.')), timeoutMs);
    Promise.resolve(promise).then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

class MockRequest extends Readable {
  constructor(method, url, headers, body) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers || {};
    this.body = Buffer.from(body || '');
    this.sent = false;
  }

  _read() {
    if (this.sent) return;
    this.sent = true;
    if (this.body.length) this.push(this.body);
    this.push(null);
  }
}

class MockResponse {
  constructor(done) {
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.destroyed = false;
    this.done = done;
  }

  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  write(body = '') {
    this.chunks.push(Buffer.from(String(body)));
    return true;
  }

  end(body = '') {
    if (body) this.write(body);
    const text = Buffer.concat(this.chunks).toString('utf8');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    this.done({ status: this.statusCode, headers: this.headers, text, json });
  }
}

function request(server, method, route, options = {}) {
  const body = options.form
    ? new URLSearchParams(options.form).toString()
    : Object.prototype.hasOwnProperty.call(options, 'json')
      ? JSON.stringify(options.json)
      : '';
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.form) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (Object.prototype.hasOwnProperty.call(options, 'json')) headers['content-type'] = 'application/json';
  headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, headers, body);
    const res = new MockResponse(resolve);
    try { server.emit('request', req, res); } catch (error) { reject(error); }
  });
}

function openEventStream(server, cookie, route = '/api/events') {
  let requestHandle = null;
  let responseHandle = null;
  let buffer = '';
  const frames = [];
  const waiters = [];

  function resolveWaiters() {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const frame = frames.find(waiter.match);
      if (!frame) continue;
      waiters.splice(index, 1);
      waiter.resolve(frame);
    }
  }

  function parseFrames() {
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const frame = { event: 'message', data: '', raw };
      raw.split('\n').forEach(line => {
        if (line.startsWith('event:')) frame.event = line.slice(6).trim();
        if (line.startsWith('data:')) frame.data += line.slice(5).trim();
      });
      if (raw && !raw.startsWith(':')) frames.push(frame);
      boundary = buffer.indexOf('\n\n');
    }
    resolveWaiters();
  }

  const connected = new Promise((resolve, reject) => {
    requestHandle = new MockRequest('GET', route, { cookie, accept: 'text/event-stream' }, '');
    responseHandle = new MockResponse(() => {});
    responseHandle.write = body => {
      buffer += String(body || '');
      parseFrames();
      try {
        assert(responseHandle.statusCode === 200, 'Event stream returned HTTP ' + responseHandle.statusCode + '.');
        assert(String(responseHandle.headers['Content-Type'] || responseHandle.headers['content-type'] || '').includes('text/event-stream'), 'Event stream response must use text/event-stream.');
        resolve();
      } catch (error) {
        reject(error);
      }
      return true;
    };
    try {
      server.emit('request', requestHandle, responseHandle);
    } catch (error) {
      reject(error);
    }
  });

  return {
    connected,
    waitForEvent(eventName, timeoutMs = 5000, predicate = () => true) {
      const match = frame => frame.event === eventName && predicate(frame);
      const existing = frames.find(match);
      if (existing) return Promise.resolve(existing);
      return waitFor(new Promise(resolve => waiters.push({ match, resolve })), timeoutMs, eventName + ' event');
    },
    close() {
      if (responseHandle) responseHandle.destroyed = true;
      if (requestHandle) requestHandle.emit('close');
    }
  };
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-live-events-'));
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = 'test';
  process.env.WOA_ADMIN_USERNAME = 'event-owner';
  process.env.WOA_ADMIN_PASSWORD = 'EventOwnerPassword123!';
  process.env.WOA_OWNER_PIN_FALLBACK_ENABLED = '0';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_WEBHOOK_AUTO_SYNC_DELAY_MS = '3600000';
  process.env.WOA_DOCUMENT_STORAGE_PROVIDER = 'local';
  process.env.WOA_DOCUMENT_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');

  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');
  let stream = null;
  let customerStream = null;
  try {
    const login = await request(server, 'POST', '/login', {
      form: { username: 'event-owner', password: 'EventOwnerPassword123!' }
    });
    assert(login.status === 302, 'Owner login failed before the live event test.');
    const cookie = String(login.headers['Set-Cookie'] || login.headers['set-cookie'] || '').split(';')[0];
    assert(cookie.includes('woa_session='), 'Owner login did not return a staff session cookie.');

    stream = openEventStream(server, cookie);
    await waitFor(stream.connected, 5000, 'event stream connection');
    const ready = await stream.waitForEvent('ready');
    assert(JSON.parse(ready.data).ok === true, 'Event stream did not send an authenticated ready frame.');

    const mutation = await request(server, 'POST', '/api/rentals/backfill-completed-pickups', {
      cookie,
      json: {}
    });
    assert(mutation.status === 200 && mutation.json && mutation.json.ok, 'The event-triggering resource mutation failed.');

    const platform = await stream.waitForEvent('platform');
    const payload = JSON.parse(platform.data);
    assert(payload.organizationId === 'org-wheelsonauto', 'Live event was not scoped to the signed-in organization.');
    assert(Array.isArray(payload.topics) && payload.topics.includes('state'), 'Live mutation event must invalidate staff state.');
    assert(String(payload.reason || '').includes('Backfill unambiguous completed pickups'), 'Live event did not preserve the mutation reason.');
    assert(payload.version, 'Live event must include the committed state version.');

    const messageMutation = await request(server, 'POST', '/api/messages/send', {
      cookie,
      json: {
        customer: 'Event Stream Customer',
        customerId: 'event-stream-customer',
        phone: '8565550199',
        channel: 'SMS',
        body: 'Event topic regression check',
        deliveryId: 'event-topic-regression-check'
      }
    });
    assert([200, 202].includes(messageMutation.status) && messageMutation.json && messageMutation.json.ok, 'The message mutation failed before topic verification.');
    const messagePlatform = await stream.waitForEvent('platform', 5000, frame => {
      try { return JSON.parse(frame.data).topics.includes('messages'); } catch { return false; }
    });
    const messagePayload = JSON.parse(messagePlatform.data);
    assert(messagePayload.topics.includes('messages'), 'A committed message change must invalidate the Messages feed without a page refresh.');

    const denied = await request(server, 'GET', '/api/events');
    assert(denied.status === 401, 'Anonymous callers must not open the staff event stream.');

    const customerAccount = await request(server, 'POST', '/api/customer-accounts', {
      cookie,
      json: {
        id: 'event-customer-account',
        name: 'Event Customer',
        customer: 'Event Customer',
        username: 'event-customer@example.com',
        email: 'event-customer@example.com',
        phone: '8565550188',
        password: 'EventCustomerPassword123!',
        status: 'Active',
        organizationId: 'org-wheelsonauto'
      }
    });
    assert(customerAccount.status === 200 && customerAccount.json && customerAccount.json.ok, 'Owner could not create the customer event test account.');
    const customerLogin = await request(server, 'POST', '/customer/login', { form: { username: 'event-customer@example.com', password: 'EventCustomerPassword123!' } });
    assert(customerLogin.status === 302, 'Customer login failed before the customer event test.');
    const customerCookie = String(customerLogin.headers['Set-Cookie'] || customerLogin.headers['set-cookie'] || '').split(';')[0];
    customerStream = openEventStream(server, customerCookie, '/api/customer/events');
    await waitFor(customerStream.connected, 5000, 'customer event stream connection');
    const customerReady = await customerStream.waitForEvent('ready');
    assert(JSON.parse(customerReady.data).ok === true, 'Customer event stream did not send an authenticated ready frame.');
    const portalMessage = await request(server, 'POST', '/api/messages/send', {
      cookie,
      json: {
        customer: 'Event Customer',
        customerAccountId: 'event-customer-account',
        email: 'event-customer@example.com',
        channel: 'Customer portal',
        body: 'Customer stream privacy check',
        deliveryId: 'customer-event-privacy-check'
      }
    });
    assert([200, 202].includes(portalMessage.status) && portalMessage.json && portalMessage.json.ok, 'Customer portal event-triggering message failed.');
    const customerPlatform = await customerStream.waitForEvent('platform', 5000, frame => {
      try { return JSON.parse(frame.data).topics.includes('messages'); } catch { return false; }
    });
    const customerPayload = JSON.parse(customerPlatform.data);
    assert(customerPayload.type === 'customer.changed' && customerPayload.topics.includes('messages'), 'Customer stream did not receive a safe message invalidation.');
    assert(!Object.prototype.hasOwnProperty.call(customerPayload, 'reason') && !Object.prototype.hasOwnProperty.call(customerPayload, 'organizationId') && !Object.prototype.hasOwnProperty.call(customerPayload, 'version'), 'Customer stream must not expose internal staff mutation metadata.');
    const deniedCustomer = await request(server, 'GET', '/api/customer/events');
    assert(deniedCustomer.status === 401, 'Anonymous callers must not open the customer event stream.');

    console.log('Live event stream check passed: staff/customer authentication, organization scope, private customer invalidation, and anonymous denial are verified.');
  } finally {
    if (stream) stream.close();
    if (customerStream) customerStream.close();
    try { server.close(); } catch {}
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
