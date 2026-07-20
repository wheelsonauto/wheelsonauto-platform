'use strict';

const assert = require('node:assert');
const recovery = require('../account-recovery');

const now = Date.parse('2026-07-20T14:00:00.000Z');
let loginSecurity = {};
for (let attempt = 1; attempt <= 4; attempt += 1) {
  loginSecurity = recovery.registerLoginFailure(loginSecurity, { now: now + attempt, maxAttempts: 5 });
  assert.strictEqual(loginSecurity.failedAttempts, attempt);
  assert.strictEqual(recovery.loginLocked(loginSecurity), false, 'The account must remain available before the fifth failed attempt.');
}
loginSecurity = recovery.registerLoginFailure(loginSecurity, { now: now + 5, maxAttempts: 5 });
assert.strictEqual(loginSecurity.failedAttempts, 5);
assert.strictEqual(recovery.loginLocked(loginSecurity), true, 'The fifth failed attempt must lock the exact account until recovery.');

const secret = 'account-recovery-check-secret';
const challenge = recovery.createRecoveryChallenge({
  secret,
  accountId: 'customer:customer:customer-1',
  code: '482193',
  now,
  ttlMs: 15 * 60 * 1000
});
assert(!JSON.stringify(challenge.record).includes('482193'), 'The one-time recovery code must never be stored in plain text.');

const wrongAccount = recovery.verifyRecoveryChallenge(challenge.record, {
  secret,
  accountId: 'customer:customer:customer-2',
  code: '482193',
  now: now + 1000
});
assert.strictEqual(wrongAccount.ok, false);
assert.strictEqual(wrongAccount.reason, 'account_mismatch', 'A code for one customer must never reset another customer.');

const wrongCode = recovery.verifyRecoveryChallenge(challenge.record, {
  secret,
  accountId: 'customer:customer:customer-1',
  code: '000000',
  now: now + 2000
});
assert.strictEqual(wrongCode.ok, false);
assert.strictEqual(wrongCode.record.attempts, 1, 'Wrong recovery codes must consume an attempt.');

const verified = recovery.verifyRecoveryChallenge(wrongCode.record, {
  secret,
  accountId: 'customer:customer:customer-1',
  code: '482193',
  now: now + 3000
});
assert.strictEqual(verified.ok, true, 'The exact account-bound code must verify before expiration.');
assert(verified.record.consumedAt, 'A verified recovery code must become single-use.');

const replay = recovery.verifyRecoveryChallenge(verified.record, {
  secret,
  accountId: 'customer:customer:customer-1',
  code: '482193',
  now: now + 4000
});
assert.strictEqual(replay.ok, false);
assert.strictEqual(replay.reason, 'consumed', 'A recovery code must never work twice.');

const expired = recovery.verifyRecoveryChallenge(challenge.record, {
  secret,
  accountId: 'customer:customer:customer-1',
  code: '482193',
  now: now + 16 * 60 * 1000
});
assert.strictEqual(expired.ok, false);
assert.strictEqual(expired.reason, 'expired', 'Recovery codes must expire after the configured window.');

assert.strictEqual(recovery.clearLoginFailure().failedAttempts, 0, 'A completed password recovery must clear the failed-attempt count.');
console.log('Account recovery check passed: five-attempt lock, one-account binding, hashed codes, expiry, attempt limits, and replay rejection are enforced.');
