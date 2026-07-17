const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const node = process.execPath;

function run(label, args) {
  const result = spawnSync(node, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('').trim();
  if (result.status !== 0) {
    throw new Error(label + ' failed' + (output ? ':\n' + output : '.'));
  }
  console.log('ok - ' + label + (output ? '\n' + output : ''));
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assetVersionCheck() {
  const index = read('index.html');
  const server = read('server.js');
  const app = read('app.js');
  const css = read('styles.css');
  const versions = [...index.matchAll(/platform-\d{8}[-a-z0-9]+/g)].map(match => match[0]);
  assert(versions.length >= 2, 'index.html must version both app.js and styles.css.');
  assert(new Set(versions).size === 1, 'index.html app/style asset versions must match.');
  const version = versions[0];
  assert(server.includes(version), 'server.js CSS_LINK must use the same asset version as index.html.');
  assert(app.includes('ifleetNextCommandBoard'), 'Dashboard iFleet next command board is missing from app.js.');
  assert(app.includes('messageCommandPanel'), 'Messages command panel is missing from app.js.');
  assert(app.includes('safeRenderRecovery'), 'Safe render recovery guard is missing from app.js.');
  assert(css.includes('.ifleet-next-board'), 'Dashboard iFleet next command styles are missing.');
  assert(!index.includes('platform-20260713-return-prep-1'), 'index.html is still using an old asset tag.');
  assert(!server.includes('platform-20260713-return-prep-1'), 'server.js is still using an old asset tag.');
  console.log('ok - asset version and latest UI guards\n' + version);
}

[
  ['server syntax', ['--check', 'server.js']],
  ['production startup gate', ['scripts/production-startup-gate-check.js']],
  ['app syntax', ['--check', 'app.js']],
  ['card setup syntax', ['--check', 'card-setup.js']],
  ['protect live data', ['scripts/protect-live-data-check.js']],
  ['static UI wiring', ['scripts/static-ui-check.js']],
  ['API route coverage', ['scripts/api-route-check.js']],
  ['role access', ['scripts/role-access-check.js']],
  ['responsive style', ['scripts/responsive-style-check.js']],
  ['messaging channels', ['scripts/messaging-channel-check.js']],
  ['Star safety', ['scripts/star-safety-check.js']],
  ['operations readiness', ['scripts/operations-readiness-check.js']],
  ['view surface', ['scripts/view-surface-check.js']],
  ['navigation state', ['scripts/navigation-state-check.js']],
  ['payment workflow', ['scripts/payment-workflow-check.js']],
  ['customer/fleet workflow', ['scripts/customer-fleet-workflow-check.js']],
  ['frontend render smoke', ['scripts/frontend-render-smoke-test.js']],
  ['client state performance budget', ['scripts/client-state-budget-check.js']],
  ['data consistency', ['scripts/data-consistency-check.js']],
  ['workflow integrity', ['scripts/workflow-integrity-check.js']],
  ['server direct smoke', ['scripts/server-direct-smoke-test.js']]
].forEach(([label, args]) => run(label, args));

assetVersionCheck();

console.log('Deep tightening check passed: payments, customers, fleet, roles, Messages, Star, reports, responsive UI, routes, and live-data protection are all verified.');
