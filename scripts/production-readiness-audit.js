'use strict';

const { productionEnvironmentReport } = require('../production-environment');
const { buildProductionReadinessAudit } = require('../production-readiness-audit');
const { productionInfrastructurePreflight, closeStateRepositoryForAudit } = require('../server');
const { userArguments } = require('./cli-arguments');

function providerProofOnly(argv = process.argv) {
  return userArguments(argv).includes('--provider-proof');
}

function auditPasses(audit, argv = process.argv) {
  return providerProofOnly(argv) ? audit.readyForLiveStripe === true : audit.readyForCustomerMigration === true;
}

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
  if (!auditPasses(audit)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      checkedAt: new Date().toISOString(),
      phase: 'controlled-clover-to-stripe-launch',
      readyForLiveStripe: false,
      readyForCustomerMigration: false,
      auditMode: 'read_only',
      error: 'Production readiness audit failed before completion.',
      errorCode: String(error && error.code || 'audit_failed').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80)
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  auditPasses,
  providerProofOnly
};
