'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

class MockRequest extends Readable {
  constructor(method, url, headers = {}, body = '') {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = Buffer.from(body);
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
  constructor(resolve) {
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
    this.resolve = resolve;
  }

  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  end(body = '') {
    this.body += String(body || '');
    this.resolve({ status: this.statusCode, headers: this.headers, text: this.body });
  }
}

function request(server, method, route, form = null) {
  const body = form ? new URLSearchParams(form).toString() : '';
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, {
      'content-type': form ? 'application/x-www-form-urlencoded' : '',
      'content-length': String(Buffer.byteLength(body))
    }, body);
    const res = new MockResponse(resolve);
    try {
      server.emit('request', req, res);
    } catch (error) {
      reject(error);
    }
  });
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-owner-auth-runtime-'));
  try {
    process.env.DATA_DIR = dataDir;
    process.env.WOA_PRODUCTION_HARDENING_REQUIRED = '1';
    process.env.WOA_ADMIN_PIN = '9999';
    process.env.WOA_ADMIN_USERNAME = 'owner';
    const password = 'OwnerPassword123!';
    const salt = 'runtime-owner-password-salt';
    process.env.WOA_ADMIN_PASSWORD_HASH = 'pbkdf2$310000$' + crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
    process.env.WOA_ADMIN_PASSWORD_SALT = salt;
    delete process.env.WOA_ADMIN_PASSWORD;
    process.env.WOA_AUTO_SYNC_MS = '3600000';
    process.env.WOA_AUTOPAY_MS = '3600000';
    process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
    delete require.cache[require.resolve('../server.js')];
    const { server } = require('../server.js');
    try {
      const page = await request(server, 'GET', '/login');
      assert.strictEqual(page.status, 200, 'The password-only production login page must render.');
      assert(!page.text.includes('Access PIN'), 'Production hardening must hide the owner PIN field.');

      const pinLogin = await request(server, 'POST', '/login', { pin: '9999' });
      assert.strictEqual(pinLogin.status, 401, 'Production hardening must reject owner PIN-only login.');

      const passwordLogin = await request(server, 'POST', '/login', { username: 'owner', password });
      assert.strictEqual(passwordLogin.status, 302, 'Production hardening must retain password-backed owner login.');
      assert(String(passwordLogin.headers['Set-Cookie'] || '').includes('woa_session='), 'A production password login must create a signed owner session.');
    } finally {
      try { server.close(); } catch (_) {}
    }
    console.log('Owner auth runtime check passed: hardened production hides and rejects owner PIN fallback while preserving password login.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
