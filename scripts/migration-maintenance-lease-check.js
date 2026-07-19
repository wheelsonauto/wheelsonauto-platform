'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const lease = require('../migration-maintenance-lease');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-maintenance-lease-'));
  const environment = {
    DATA_DIR: temp,
    WOA_SESSION_SECRET: 'maintenance-lease-check-secret-2026',
    WOA_SERVICE_ID: 'srv-maintenance-lease-check',
    WOA_DEPLOY_COMMIT: 'abcdef123456'
  };
  try {
    const inactive = await lease.publishLease({ environment, maintenanceMode: false, now: '2026-07-19T12:00:00.000Z' });
    assert.strictEqual(inactive.maintenanceMode, false);
    await assert.rejects(() => lease.assertActiveLease({ environment, now: Date.parse('2026-07-19T12:00:10.000Z') }), /not in migration maintenance mode/i);

    const active = await lease.publishLease({ environment, maintenanceMode: true, now: '2026-07-19T12:01:00.000Z' });
    const verified = await lease.assertActiveLease({ environment, now: Date.parse('2026-07-19T12:01:20.000Z') });
    assert.strictEqual(verified.instanceId, active.instanceId);
    assert.strictEqual(verified.renderCommit, environment.WOA_DEPLOY_COMMIT);
    assert.match(verified.leaseChecksum, /^[a-f0-9]{64}$/);
    assert.match(verified.signatureChecksum, /^[a-f0-9]{64}$/);
    if (process.platform !== 'win32') assert.strictEqual((await fs.stat(lease.leasePath(temp))).mode & 0o777, 0o600, 'The shared lease must be owner-readable only.');

    await assert.rejects(
      () => lease.assertActiveLease({ environment: { ...environment, WOA_SERVICE_ID: 'srv-other' }, now: Date.parse('2026-07-19T12:01:20.000Z') }),
      /different Render service/i
    );
    await assert.rejects(
      () => lease.assertActiveLease({ environment: { ...environment, WOA_DEPLOY_COMMIT: '999999999999' }, now: Date.parse('2026-07-19T12:01:20.000Z') }),
      /different deployed commit/i
    );
    await assert.rejects(
      () => lease.assertActiveLease({ environment, now: Date.parse('2026-07-19T12:04:00.000Z') }),
      /stale or has an invalid heartbeat/i
    );

    const controller = lease.createLeaseController({ environment, maintenanceMode: true });
    await controller.start();
    await controller.stop();
    await assert.rejects(() => lease.assertActiveLease({ environment }), /not in migration maintenance mode/i, 'Stopping the deployed maintenance process must invalidate its own active lease.');
    await lease.publishLease({ environment, maintenanceMode: true, now: '2026-07-19T12:01:00.000Z' });

    const tampered = JSON.parse(await fs.readFile(lease.leasePath(temp), 'utf8'));
    tampered.maintenanceMode = false;
    await fs.writeFile(lease.leasePath(temp), JSON.stringify(tampered, null, 2) + '\n', 'utf8');
    await assert.rejects(() => lease.assertActiveLease({ environment, now: Date.parse('2026-07-19T12:01:20.000Z') }), /signature is invalid/i);

    console.log('Migration-maintenance lease check passed: inactive, active, service, commit, freshness, file privacy, and HMAC tamper guards are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
