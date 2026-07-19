'use strict';

const { productionEnvironmentReport } = require('../production-environment');

const report = productionEnvironmentReport(process.env);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
