'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const {
  fatalReason,
  createFatalProcessMonitor,
  installFatalProcessHandlers
} = require('../fatal-process-monitor');

async function main() {
  const normalized = fatalReason({ code: 'controlled' }, 'unhandled-rejection');
  assert(normalized instanceof Error && /Unhandled promise rejection/.test(normalized.message), 'Non-Error rejection reasons must become actionable errors.');

  const reports = [];
  const shutdowns = [];
  const exits = [];
  const clearedTimers = [];
  const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const monitor = createFatalProcessMonitor({
    reportFailure: async (...args) => reports.push(args),
    shutdown: async (...args) => shutdowns.push(args),
    exit: code => exits.push(code),
    logger: { error() {} },
    setTimer: () => timer,
    clearTimer: value => clearedTimers.push(value),
    forceExitAfterMs: 1234
  });
  const handled = await monitor.handle('uncaught-exception', new Error('controlled fatal error'));
  assert.deepStrictEqual(handled, { handled: true, duplicate: false, reported: true });
  assert.strictEqual(reports.length, 1, 'Fatal process errors must enter the durable operational monitor exactly once.');
  assert.strictEqual(reports[0][0], 'process-uncaught-exception');
  assert.strictEqual(reports[0][2].route, 'Node.js process');
  assert.strictEqual(reports[0][3].alert, true);
  assert.strictEqual(reports[0][3].severity, 'critical');
  assert.deepStrictEqual(shutdowns, [['fatal-uncaught-exception', 1]], 'Fatal errors must request a non-zero graceful shutdown.');
  assert.strictEqual(timer.unrefCalled, true, 'Fatal shutdown safety timer must not keep an otherwise drained process alive.');
  assert.deepStrictEqual(clearedTimers, [timer]);
  assert.deepStrictEqual(exits, []);

  let releaseReport;
  const pendingReport = new Promise(resolve => { releaseReport = resolve; });
  const duplicateExits = [];
  const duplicateMonitor = createFatalProcessMonitor({
    reportFailure: async () => pendingReport,
    shutdown: async () => {},
    exit: code => duplicateExits.push(code),
    logger: { error() {} },
    setTimer: () => ({ unref() {} }),
    clearTimer() {}
  });
  const firstFatal = duplicateMonitor.handle('unhandled-rejection', 'first');
  const duplicate = await duplicateMonitor.handle('uncaught-exception', new Error('second'));
  assert.strictEqual(duplicate.duplicate, true, 'A second fatal signal must not start another state/email write.');
  assert.deepStrictEqual(duplicateExits, [1], 'A second fatal signal during shutdown must fail closed immediately.');
  releaseReport();
  await firstFatal;

  const failedShutdownExits = [];
  const failedShutdownMonitor = createFatalProcessMonitor({
    reportFailure: async () => { throw new Error('repository unavailable'); },
    shutdown: async () => { throw new Error('shutdown unavailable'); },
    exit: code => failedShutdownExits.push(code),
    logger: { error() {} },
    setTimer: () => ({ unref() {} }),
    clearTimer() {}
  });
  const failed = await failedShutdownMonitor.handle('unhandled-rejection', 'controlled rejection');
  assert.strictEqual(failed.reported, false, 'A failed persistence attempt must not be reported as durable evidence.');
  assert.deepStrictEqual(failedShutdownExits, [1], 'A failed graceful shutdown must force a non-zero exit.');

  const fakeProcess = new EventEmitter();
  const installedCalls = [];
  const installedExits = [];
  fakeProcess.exit = code => installedExits.push(code);
  fakeProcess.stderr = { write() {} };
  const cleanup = installFatalProcessHandlers(fakeProcess, {
    handle: async (kind, reason) => installedCalls.push([kind, reason && reason.message || String(reason)])
  });
  fakeProcess.emit('uncaughtException', new Error('installed uncaught'));
  fakeProcess.emit('unhandledRejection', 'installed rejection');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(installedCalls, [
    ['uncaught-exception', 'installed uncaught'],
    ['unhandled-rejection', 'installed rejection']
  ], 'Both Node fatal event types must be connected to the shared monitor.');
  assert.deepStrictEqual(installedExits, []);
  cleanup();
  assert.strictEqual(fakeProcess.listenerCount('uncaughtException'), 0);
  assert.strictEqual(fakeProcess.listenerCount('unhandledRejection'), 0);

  console.log('Fatal process monitor check passed: uncaught exceptions and unhandled rejections create one critical incident, attempt an owner alert, drain writes, and exit non-zero.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
