const fs = require('node:fs');
const path = require('node:path');
const { repairDataIds } = require('../server.js');

const root = path.resolve(__dirname, '..');
const target = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.join(root, 'data.json');

const before = fs.readFileSync(target, 'utf8');
const data = JSON.parse(before);
repairDataIds(data);
const after = JSON.stringify(data, null, 2) + '\n';

if (after !== before) {
  fs.writeFileSync(target, after, 'utf8');
  console.log(`Repaired ${path.relative(root, target) || target}`);
} else {
  console.log(`No repair needed for ${path.relative(root, target) || target}`);
}
