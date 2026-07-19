const assert = require('assert');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const migrationMaintenanceLease = require('../migration-maintenance-lease');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'server.js');

function request(port, method, pathname, body = '', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers: {
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForHealth(port, child, output) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Maintenance test server exited early: ' + output.text);
    try {
      const response = await request(port, 'GET', '/healthz');
      if (response.status === 200) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Maintenance test server did not become healthy: ' + output.text);
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-migration-maintenance-'));
  const port = 44000 + Math.floor(Math.random() * 1000);
  const output = { text: '' };
  const childEnvironment = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: temp,
    WOA_DATA_BACKEND: 'json',
    WOA_MIGRATION_MAINTENANCE_MODE: '1',
    WOA_PRODUCTION_HARDENING_REQUIRED: '0',
    WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED: '0',
    WOA_SESSION_SECRET: 'maintenance-check-session-secret-2026',
    WOA_SERVICE_ID: 'srv-maintenance-runtime-check',
    WOA_DEPLOY_COMMIT: 'abcdef1234567890abcdef1234567890abcdef12',
    WOA_ADMIN_USERNAME: 'maintenance-owner',
    WOA_ADMIN_PASSWORD: 'maintenance-owner-password',
    WOA_ADMIN_PIN: '',
    WOA_OWNER_PIN_FALLBACK_ENABLED: '0',
    CLOVER_ACCESS_TOKEN: '',
    STRIPE_SECRET_KEY: '',
    TELNYX_API_KEY: '',
    RESEND_API_KEY: '',
    OPENAI_API_KEY: ''
  };
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output.text += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { output.text += chunk.toString('utf8'); });

  try {
    const health = await waitForHealth(port, child, output);
    assert.strictEqual(health.json && health.json.migrationMaintenance, true, 'Health must disclose the active migration write freeze without exposing state.');
    assert.strictEqual(health.json && health.json.migrationMaintenanceLease, 'active', 'Health must confirm the deployed process published its signed shared-disk maintenance lease before accepting reads.');
    const activeLease = await migrationMaintenanceLease.assertActiveLease({ environment: childEnvironment });
    assert.strictEqual(activeLease.serviceId, childEnvironment.WOA_SERVICE_ID, 'The deployed maintenance server must publish a signed shared-disk lease under its exact service identity.');
    assert.strictEqual(activeLease.renderCommit, childEnvironment.WOA_DEPLOY_COMMIT, 'The maintenance lease must identify the exact deployed commit.');

    const blockedState = await request(port, 'PUT', '/api/state', '{}', { 'Content-Type': 'application/json' });
    assert.strictEqual(blockedState.status, 503, 'State writes must be rejected during a protected migration window.');
    assert.strictEqual(blockedState.json && blockedState.json.code, 'migration_maintenance');
    assert.strictEqual(blockedState.json && blockedState.json.retryable, true);
    assert.strictEqual(blockedState.headers['retry-after'], '120');

    const blockedWebhook = await request(port, 'POST', '/api/webhooks/stripe', '{}', { 'Content-Type': 'application/json' });
    assert.strictEqual(blockedWebhook.status, 503, 'Provider webhooks must receive a retryable response rather than mutate the source snapshot.');
    assert.strictEqual(blockedWebhook.json && blockedWebhook.json.code, 'migration_maintenance');

    const blockedCustomerLogin = await request(port, 'POST', '/customer/login', 'username=customer&password=test', { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(blockedCustomerLogin.status, 503, 'Customer login activation must not create a portal record during the migration window.');

    const staffLogin = await request(port, 'POST', '/login', 'username=maintenance-owner&password=maintenance-owner-password', { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(staffLogin.status, 302, 'Existing staff must still be able to establish a read-only session during maintenance.');

    const publicRead = await request(port, 'GET', '/site-preview');
    assert.strictEqual(publicRead.status, 200, 'Read-only website access must remain available during migration maintenance.');

    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.match(output.text, /migration maintenance mode is active/i, 'Startup must visibly confirm that every background writer is paused.');
    assert.doesNotMatch(output.text, /inbound SMS connected|background autopay|automatic Clover sync/i, 'No background writer may start in migration maintenance mode.');

    console.log('Migration maintenance check passed: reads and staff login remain available while state writes, customer activation, provider webhooks, autopay, sync, messaging, and monitoring writers are paused with retryable 503 responses.');
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    await assert.rejects(
      () => migrationMaintenanceLease.assertActiveLease({ environment: childEnvironment }),
      /not in migration maintenance mode/i,
      'Graceful shutdown must immediately invalidate the maintenance lease.'
    );
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
