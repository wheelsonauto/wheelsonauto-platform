'use strict';

function fatalReason(reason, kind) {
  if (reason instanceof Error) return reason;
  const detail = typeof reason === 'string' ? reason : (() => {
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  })();
  return new Error((kind === 'unhandled-rejection' ? 'Unhandled promise rejection' : 'Uncaught exception') + ': ' + (detail || 'Unknown fatal error'));
}

function createFatalProcessMonitor(options = {}) {
  const reportFailure = typeof options.reportFailure === 'function' ? options.reportFailure : async () => ({});
  const shutdown = typeof options.shutdown === 'function' ? options.shutdown : async () => {};
  const exit = typeof options.exit === 'function' ? options.exit : code => process.exit(code);
  const logger = options.logger || console;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const forceExitAfterMs = Math.max(1000, Number(options.forceExitAfterMs || 50000));
  let handling = false;

  async function handle(kind, reason) {
    const sourceKind = kind === 'unhandled-rejection' ? 'unhandled-rejection' : 'uncaught-exception';
    const error = fatalReason(reason, sourceKind);
    if (handling) {
      logger.error('WheelsonAuto received another fatal process error during shutdown:', error.message);
      exit(1);
      return { handled: false, duplicate: true, reported: false };
    }

    handling = true;
    logger.error('WheelsonAuto fatal process error (' + sourceKind + '):', error.message);
    const forceExit = setTimer(() => {
      logger.error('WheelsonAuto fatal shutdown exceeded its safety deadline.');
      exit(1);
    }, forceExitAfterMs);
    if (forceExit && typeof forceExit.unref === 'function') forceExit.unref();

    let reported = false;
    try {
      await reportFailure('process-' + sourceKind, error, {
        route: 'Node.js process',
        source: sourceKind
      }, { alert: true, severity: 'critical' });
      reported = true;
    } catch (reportError) {
      logger.error('WheelsonAuto could not persist the fatal process incident:', reportError && reportError.message || reportError);
    }

    try {
      await shutdown('fatal-' + sourceKind, 1);
      clearTimer(forceExit);
      return { handled: true, duplicate: false, reported };
    } catch (shutdownError) {
      clearTimer(forceExit);
      logger.error('WheelsonAuto fatal shutdown failed:', shutdownError && shutdownError.message || shutdownError);
      exit(1);
      return { handled: false, duplicate: false, reported };
    }
  }

  return {
    handle,
    isHandling: () => handling
  };
}

function installFatalProcessHandlers(processRef, monitor) {
  if (!processRef || typeof processRef.on !== 'function') throw new Error('A process-like event emitter is required.');
  if (!monitor || typeof monitor.handle !== 'function') throw new Error('A fatal process monitor is required.');

  const invoke = (kind, reason) => {
    Promise.resolve(monitor.handle(kind, reason)).catch(error => {
      const message = error && error.message || error;
      if (processRef.stderr && typeof processRef.stderr.write === 'function') {
        processRef.stderr.write('WheelsonAuto fatal monitor failed: ' + message + '\n');
      }
      if (typeof processRef.exit === 'function') processRef.exit(1);
    });
  };
  const uncaught = error => invoke('uncaught-exception', error);
  const rejected = reason => invoke('unhandled-rejection', reason);
  processRef.on('uncaughtException', uncaught);
  processRef.on('unhandledRejection', rejected);

  return () => {
    if (typeof processRef.removeListener !== 'function') return;
    processRef.removeListener('uncaughtException', uncaught);
    processRef.removeListener('unhandledRejection', rejected);
  };
}

module.exports = {
  fatalReason,
  createFatalProcessMonitor,
  installFatalProcessHandlers
};
