'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const patterns = [
  ['Stripe live or restricted key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['GitHub personal access token', /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['Resend API key', /\bre_[A-Za-z0-9]{20,}\b/g],
  ['Private key block', /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/g]
];

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function isBinary(bytes) {
  return bytes.includes(0);
}

function main() {
  const findings = [];
  trackedFiles().forEach(relativePath => {
    const absolutePath = path.join(root, relativePath);
    let bytes;
    try {
      bytes = fs.readFileSync(absolutePath);
    } catch (error) {
      findings.push({ file: relativePath, rule: 'Tracked file cannot be read' });
      return;
    }
    if (isBinary(bytes)) return;
    const source = bytes.toString('utf8');
    patterns.forEach(([rule, expression]) => {
      expression.lastIndex = 0;
      if (expression.test(source)) findings.push({ file: relativePath, rule });
    });
  });

  if (findings.length) {
    const summary = findings.map(finding => finding.file + ' (' + finding.rule + ')').join(', ');
    throw new Error('Potential production secrets are tracked in source: ' + summary + '. Move credentials to Render environment variables and rotate any exposed credential.');
  }
  console.log('Secret hygiene check passed: no tracked production credential patterns or private key blocks found.');
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exit(1);
}
