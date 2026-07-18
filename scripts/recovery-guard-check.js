'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const recoveryGuard = require('../recovery-guard');

function main() {
  const revokedAt = '2026-07-18T15:00:00.000Z';
  const current = {
    security: { ownerLogin: { username: 'current-owner', passwordHash: 'current-owner-hash', passwordSalt: 'current-owner-salt', passwordUpdatedAt: '2026-07-17T10:00:00.000Z' } },
    staffAccounts: [{ id: 'staff-current', username: 'manager', role: 'Manager', status: 'Active', passwordHash: 'current-staff-hash', passwordSalt: 'current-staff-salt', passwordUpdatedAt: '2026-07-17T11:00:00.000Z' }],
    customerAccounts: [{ id: 'customer-current', customer: 'Current Customer', status: 'Active', passwordHash: 'current-customer-hash', passwordSalt: 'current-customer-salt', passwordUpdatedAt: '2026-07-17T12:00:00.000Z' }]
  };
  const snapshot = {
    security: { ownerLogin: { username: 'old-owner', passwordHash: 'old-owner-hash', passwordSalt: 'old-owner-salt', passwordUpdatedAt: '2025-01-01T00:00:00.000Z' }, retainedSetting: true },
    staffAccounts: [{ id: 'staff-removed', username: 'removed-manager', role: 'Manager', status: 'Active', passwordHash: 'old-staff-hash', passwordSalt: 'old-staff-salt' }],
    customerAccounts: [{ id: 'customer-removed', customer: 'Removed Customer', status: 'Active', passwordHash: 'old-customer-hash', passwordSalt: 'old-customer-salt' }],
    vehicles: [{ id: 'vehicle-snapshot', status: 'Ready' }]
  };

  const restored = recoveryGuard.preserveAccessControlAcrossRecovery(current, snapshot, { revokedAt });
  assert.deepStrictEqual(restored.vehicles, snapshot.vehicles, 'Recovery must still restore the selected business-state snapshot.');
  assert.strictEqual(restored.security.retainedSetting, true, 'Recovery must retain non-access security settings from the selected snapshot.');
  assert.strictEqual(restored.security.ownerLogin.username, 'current-owner', 'Recovery must not resurrect an old owner login identity.');
  assert.strictEqual(restored.security.ownerLogin.passwordHash, 'current-owner-hash', 'Recovery must preserve the current owner password record.');
  assert.strictEqual(restored.security.ownerLogin.passwordUpdatedAt, revokedAt, 'Recovery must revoke every previously issued owner session.');
  assert.deepStrictEqual(restored.staffAccounts.map(row => row.id), ['staff-current'], 'Recovery must not resurrect staff accounts removed after the selected snapshot.');
  assert.strictEqual(restored.staffAccounts[0].passwordHash, 'current-staff-hash', 'Recovery must preserve current staff credentials.');
  assert.strictEqual(restored.staffAccounts[0].passwordUpdatedAt, revokedAt, 'Recovery must revoke every previously issued staff session.');
  assert.deepStrictEqual(restored.customerAccounts.map(row => row.id), ['customer-current'], 'Recovery must not resurrect customer portal accounts removed after the selected snapshot.');
  assert.strictEqual(restored.customerAccounts[0].passwordHash, 'current-customer-hash', 'Recovery must preserve current customer credentials.');
  assert.strictEqual(restored.customerAccounts[0].passwordUpdatedAt, revokedAt, 'Recovery must revoke every previously issued customer session.');

  assert.strictEqual(recoveryGuard.recoveryWriteGenerationIsCurrent({ recoveryGeneration: 7 }, 7), true, 'A state write read after the current recovery must remain valid.');
  assert.strictEqual(recoveryGuard.recoveryWriteGenerationIsCurrent({ recoveryGeneration: 6 }, 7), false, 'A state write read before the latest recovery must be stale.');
  assert.strictEqual(recoveryGuard.recoveryWriteGenerationIsCurrent({}, 7), true, 'Server-created writes without read metadata must remain supported.');
  assert.throws(
    () => recoveryGuard.assertCurrentRecoveryGeneration({ recoveryGeneration: 6 }, 7),
    error => error && error.code === 'state_recovery_stale_write' && error.statusCode === 409,
    'A stale pre-recovery write must fail closed with a retryable conflict.'
  );

  const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  const repositorySource = fs.readFileSync(path.resolve(__dirname, '..', 'state-repository.js'), 'utf8');
  assert(serverSource.includes('recoveryGuard.assertCurrentRecoveryGeneration(data && data[STATE_READ_META] || {}, stateRecoveryGeneration)'), 'Every normal state write must enforce the recovery generation guard.');
  assert(serverSource.includes('const recoveryJob = writeDataQueue.then(async () => {') && serverSource.includes('stateRecoveryGeneration += 1'), 'Snapshot recovery must serialize with all state writes and invalidate pre-recovery reads before queued work resumes.');
  assert(serverSource.includes("sessionSetCookie('woa_session', '', { maxAge: 0 })"), 'The owner recovery response must clear the session that authorized the restore.');
  assert(repositorySource.includes("assertChecksum(current.state, current.checksum, 'Current PostgreSQL state before recovery')"), 'PostgreSQL recovery must verify both the current state and selected snapshot before mutation.');
  assert(repositorySource.includes('currentState: this.repair(clone(current.state))'), 'The recovery transform must receive the transactionally locked current state for access-control preservation.');

  console.log('Recovery guard check passed: restore preserves current access control, revokes sessions, verifies checksums, and rejects stale queued writes.');
}

main();
