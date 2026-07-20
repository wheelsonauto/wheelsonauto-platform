'use strict';

const { productionEnvironmentReport } = require('../production-environment');
const { buildProductionReadinessAudit } = require('../production-readiness-audit');
const { productionInfrastructurePreflight, closeStateRepositoryForAudit } = require('../server');

async function main() {
  let infrastructure;
  try {
    infrastructure = await productionInfrastructurePreflight();
  } finally {
    await closeStateRepositoryForAudit();
  }
  const audit = buildProductionReadinessAudit({
    environment: productionEnvironmentReport(process.env),
    infrastructure
  });
  console.log(JSON.stringify(audit, null, 2));
  if (!audit.readyForLiveStripe) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    checkedAt: new Date().toISOString(),
    phase: 'controlled-clover-to-stripe-launch',
    readyForLiveStripe: false,
    auditMode: 'read_only',
    error: 'Production readiness audit failed before completion.',
    errorCode: String(error && error.code || 'audit_failed').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80)
  }, null, 2));
  process.exitCode = 1;
});
