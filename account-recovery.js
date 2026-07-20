'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_LOGIN_FAILURES = 5;
const DEFAULT_MAX_CODE_ATTEMPTS = 5;
const DEFAULT_CODE_TTL_MS = 15 * 60 * 1000;

function normalizedTimestamp(value, fallback = Date.now()) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recoveryCodeHash(secret, accountId, salt, code) {
  return crypto.createHmac('sha256', String(secret || ''))
    .update([String(accountId || ''), String(salt || ''), String(code || '')].join('\u0000'), 'utf8')
    .digest('hex');
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function registerLoginFailure(current = {}, options = {}) {
  const now = normalizedTimestamp(options.now);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || DEFAULT_MAX_LOGIN_FAILURES));
  const failedAttempts = Math.max(0, Number(current.failedAttempts || 0)) + 1;
  return {
    failedAttempts,
    lastFailedAt: new Date(now).toISOString(),
    lockedAt: current.lockedAt || (failedAttempts >= maxAttempts ? new Date(now).toISOString() : ''),
    recoveryRequired: !!current.recoveryRequired || failedAttempts >= maxAttempts
  };
}

function loginLocked(record = {}) {
  return record.recoveryRequired === true || !!record.lockedAt;
}

function clearLoginFailure() {
  return { failedAttempts: 0, lastFailedAt: '', lockedAt: '', recoveryRequired: false };
}

function createRecoveryChallenge(options = {}) {
  const accountId = String(options.accountId || '').trim();
  const secret = String(options.secret || '');
  if (!accountId || !secret) throw new Error('Recovery challenge needs an account ID and signing secret.');
  const now = normalizedTimestamp(options.now);
  const ttlMs = Math.max(60 * 1000, Number(options.ttlMs || DEFAULT_CODE_TTL_MS));
  const code = String(options.code || crypto.randomInt(100000, 1000000));
  if (!/^\d{6}$/.test(code)) throw new Error('Recovery code must be exactly six digits.');
  const salt = crypto.randomBytes(18).toString('hex');
  return {
    code,
    record: {
      accountId,
      codeHash: recoveryCodeHash(secret, accountId, salt, code),
      salt,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      attempts: 0,
      maxAttempts: Math.max(1, Number(options.maxAttempts || DEFAULT_MAX_CODE_ATTEMPTS)),
      consumedAt: ''
    }
  };
}

function verifyRecoveryChallenge(record = {}, options = {}) {
  const now = normalizedTimestamp(options.now);
  const accountId = String(options.accountId || '').trim();
  const code = String(options.code || '').trim();
  if (!record.codeHash || !record.salt || !record.accountId) return { ok: false, reason: 'missing', record };
  if (!accountId || record.accountId !== accountId) return { ok: false, reason: 'account_mismatch', record };
  if (record.consumedAt) return { ok: false, reason: 'consumed', record };
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'invalid', record };
  const expiresAt = Date.parse(record.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { ok: false, reason: 'expired', record };
  const attempts = Math.max(0, Number(record.attempts || 0));
  const maxAttempts = Math.max(1, Number(record.maxAttempts || DEFAULT_MAX_CODE_ATTEMPTS));
  if (attempts >= maxAttempts) return { ok: false, reason: 'attempts_exhausted', record };
  const expected = recoveryCodeHash(options.secret, accountId, record.salt, code);
  if (!secureEqual(expected, record.codeHash)) {
    const nextRecord = { ...record, attempts: attempts + 1, lastAttemptAt: new Date(now).toISOString() };
    return { ok: false, reason: nextRecord.attempts >= maxAttempts ? 'attempts_exhausted' : 'invalid', record: nextRecord };
  }
  return { ok: true, reason: 'verified', record: { ...record, consumedAt: new Date(now).toISOString() } };
}

module.exports = {
  DEFAULT_MAX_LOGIN_FAILURES,
  DEFAULT_MAX_CODE_ATTEMPTS,
  DEFAULT_CODE_TTL_MS,
  recoveryCodeHash,
  registerLoginFailure,
  loginLocked,
  clearLoginFailure,
  createRecoveryChallenge,
  verifyRecoveryChallenge
};
