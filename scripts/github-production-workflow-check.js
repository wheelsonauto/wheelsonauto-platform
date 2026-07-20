'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditCandidates } = require('./dependency-vulnerability-check');

const workflowFile = path.resolve(__dirname, '..', '.github', 'workflows', 'production-checks.yml');
const lockfile = path.resolve(__dirname, '..', 'pnpm-lock.yaml');
assert(fs.existsSync(workflowFile), 'The production GitHub Actions workflow is missing.');
assert(fs.existsSync(lockfile), 'pnpm-lock.yaml is required for reproducible production dependency installs.');

const auditFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'woa-audit-manager-'));
try {
  const pnpmOnly = path.join(auditFixture, 'pnpm');
  const npmOnly = path.join(auditFixture, 'npm');
  const both = path.join(auditFixture, 'both');
  const empty = path.join(auditFixture, 'empty');
  [pnpmOnly, npmOnly, both, empty].forEach(directory => fs.mkdirSync(directory));
  fs.writeFileSync(path.join(pnpmOnly, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.writeFileSync(path.join(npmOnly, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(both, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.writeFileSync(path.join(both, 'package-lock.json'), '{}\n');
  assert.deepStrictEqual(auditCandidates({ cwd: pnpmOnly, platform: 'linux' }).map(item => item.command), ['pnpm']);
  assert.deepStrictEqual(auditCandidates({ cwd: npmOnly, platform: 'linux' }).map(item => item.command), ['npm']);
  assert.deepStrictEqual(auditCandidates({ cwd: both, platform: 'win32' }).map(item => item.command), ['pnpm.cmd', 'npm.cmd']);
  assert.deepStrictEqual(auditCandidates({ cwd: empty, platform: 'linux' }), []);
} finally {
  fs.rmSync(auditFixture, { recursive: true, force: true });
}

const workflow = fs.readFileSync(workflowFile, 'utf8');
const required = [
  'pull_request:',
  'push:',
  '- main',
  'workflow_dispatch:',
  'permissions:',
  'contents: read',
  'cancel-in-progress: true',
  'runs-on: ubuntu-latest',
  'timeout-minutes: 35',
  'uses: actions/checkout@v4',
  'uses: pnpm/action-setup@v4',
  'version: 11.9.0',
  'uses: actions/setup-node@v4',
  'node-version: "24"',
  'pnpm install --frozen-lockfile',
  'pnpm run check'
];

required.forEach(value => {
  assert(workflow.includes(value), 'The production workflow must include: ' + value);
});

assert(
  workflow.indexOf('uses: actions/setup-node@v4') < workflow.indexOf('uses: pnpm/action-setup@v4'),
  'The production workflow must install Node.js before pnpm so pnpm uses the pinned supported runtime.'
);

assert(!/\b(?:DATABASE_URL|STRIPE_SECRET_KEY|OPENAI_API_KEY|TELNYX_API_KEY|RESEND_API_KEY)\s*:/i.test(workflow), 'The CI workflow must not inject production provider or database credentials.');
assert(!/\b(?:deploy|render deploy|stripe trigger)\b/i.test(workflow), 'The verification workflow must not deploy or trigger paid provider actions.');

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
const checkScript = String(packageJson.scripts && packageJson.scripts.check || '');
assert(checkScript.includes('scripts/protect-live-data-check.js'), 'Production CI must retain the live data staging guard.');
assert(checkScript.includes('scripts/postgres-runtime-check.js'), 'Production CI must execute the PostgreSQL transaction and recovery drill.');
assert(checkScript.includes('scripts/object-storage-runtime-check.js'), 'Production CI must execute encrypted object-storage behavior checks.');
assert(checkScript.includes('scripts/server-direct-smoke-test.js'), 'Production CI must execute direct authenticated workflow tests.');

console.log('GitHub production workflow check passed: pull requests and main pushes run the locked full suite, dependency audit, PostgreSQL 18 runtime drill, storage checks, and live-data guard without production secrets or deploy actions.');
